// Vote state and the pure functions both frames use. Nothing here talks to
// Lume: every function takes a vote (or null) and returns a new one, so a
// device that applies the same messages in any order lands on the same state.
;(function () {
  const LIMITS = {
    question: 200,
    option: 60,
    name: 64,
    minOptions: 2,
    maxOptions: 6,
  }

  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const isPlayerId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64

  function randomId() {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  function parsePerson(v) {
    if (!isObject(v) || !isPlayerId(v.playerId) || !isText(v.name, LIMITS.name)) return null
    return { playerId: v.playerId, name: v.name }
  }

  function parseBallots(v, optionCount) {
    if (!isObject(v)) return null
    const out = {}
    for (const [voter, b] of Object.entries(v)) {
      if (!isPlayerId(voter) || !isObject(b)) return null
      if (!isText(b.name, LIMITS.name) || !isTime(b.at)) return null
      if (!Number.isInteger(b.option) || b.option < 0 || b.option >= optionCount) return null
      out[voter] = { name: b.name, option: b.option, at: b.at }
    }
    return out
  }

  /** a vote off the network, cleaned, or null if anything is off */
  function parseVote(v) {
    if (!isObject(v)) return null
    if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 64) return null
    if (!isText(v.question, LIMITS.question)) return null
    if (!Array.isArray(v.options) || v.options.length < LIMITS.minOptions || v.options.length > LIMITS.maxOptions) {
      return null
    }
    if (!v.options.every((o) => isText(o, LIMITS.option))) return null
    if (typeof v.anonymous !== 'boolean' || !isTime(v.startedAt)) return null
    if (v.status !== 'open' && v.status !== 'ended') return null
    const starter = parsePerson(v.starter)
    if (!starter) return null
    const ballots = parseBallots(v.ballots, v.options.length)
    if (!ballots) return null
    let endedBy = null
    if (v.status === 'ended') {
      endedBy = parsePerson(v.endedBy)
      if (!endedBy) return null
    }
    return {
      id: v.id,
      question: v.question,
      options: [...v.options],
      anonymous: v.anonymous,
      starter,
      startedAt: v.startedAt,
      status: v.status,
      ballots,
      endedBy,
    }
  }

  /**
   * A new open vote from the start form, or a string saying what's wrong.
   * Blank option rows are dropped.
   */
  function createVote(input, starter, now) {
    const question = String(input.question || '').trim()
    const options = (input.options || []).map((o) => String(o).trim()).filter((o) => o.length > 0)
    if (!question) return 'Ask a question.'
    if (question.length > LIMITS.question) return `Keep the question under ${LIMITS.question} characters.`
    if (options.length < LIMITS.minOptions) return `Give at least ${LIMITS.minOptions} options.`
    if (options.length > LIMITS.maxOptions) return `Give at most ${LIMITS.maxOptions} options.`
    if (options.some((o) => o.length > LIMITS.option)) return `Keep each option under ${LIMITS.option} characters.`
    return {
      id: randomId(),
      question,
      options,
      anonymous: !!input.anonymous,
      starter: { playerId: starter.playerId, name: starter.name },
      startedAt: now,
      status: 'open',
      ballots: {},
      endedBy: null,
    }
  }

  /** every device settles on the same vote when two start at once */
  const startsFirst = (a, b) => a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.id < b.id)

  /** per voter, the ballot cast last */
  function mergeBallots(a, b) {
    const out = { ...a }
    for (const [voter, ballot] of Object.entries(b)) {
      if (!out[voter] || ballot.at > out[voter].at) out[voter] = ballot
    }
    return out
  }

  /**
   * Two copies of "the current vote" combined. Same vote: ballots unioned,
   * ended if either copy is. Different votes: open beats ended, the earlier
   * of two open votes wins, the later of two ended votes stays.
   */
  function merge(mine, theirs) {
    if (!theirs) return mine
    if (!mine) return theirs
    if (mine.id === theirs.id) {
      const ended = mine.status === 'ended' ? mine : theirs.status === 'ended' ? theirs : null
      return {
        ...mine,
        ballots: mergeBallots(mine.ballots, theirs.ballots),
        status: ended ? 'ended' : 'open',
        endedBy: ended ? ended.endedBy : null,
      }
    }
    if (mine.status !== theirs.status) return mine.status === 'open' ? mine : theirs
    if (mine.status === 'open') return startsFirst(mine, theirs) ? mine : theirs
    return mine.startedAt >= theirs.startedAt ? mine : theirs
  }

  /** a ballot for the open vote; stale or malformed ones leave it unchanged */
  function applyBallot(vote, voterId, args) {
    if (!vote || vote.status !== 'open' || !isObject(args) || args.voteId !== vote.id) return vote
    if (!isPlayerId(voterId) || !isText(args.name, LIMITS.name) || !isTime(args.at)) return vote
    if (!Number.isInteger(args.option) || args.option < 0 || args.option >= vote.options.length) return vote
    const current = vote.ballots[voterId]
    if (current && current.at >= args.at) return vote
    return {
      ...vote,
      ballots: { ...vote.ballots, [voterId]: { name: args.name, option: args.option, at: args.at } },
    }
  }

  /** the starter or the DM may end a vote */
  const canEnd = (vote, playerId, role) => !!vote && vote.status === 'open' && (vote.starter.playerId === playerId || role === 'dm')

  /** per option: how many picked it, and who (empty for an anonymous vote) */
  function tally(vote) {
    const rows = vote.options.map((label) => ({ label, count: 0, names: [] }))
    for (const ballot of Object.values(vote.ballots)) {
      const row = rows[ballot.option]
      if (!row) continue
      row.count += 1
      if (!vote.anonymous) row.names.push(ballot.name)
    }
    for (const row of rows) row.names.sort((a, b) => a.localeCompare(b))
    return rows
  }

  // --- roster: who is here, as playerId -> { name, devices } ------------------

  function parseRoster(v) {
    if (!isObject(v)) return null
    const out = {}
    for (const [playerId, entry] of Object.entries(v)) {
      if (!isPlayerId(playerId) || !isObject(entry) || !isText(entry.name, LIMITS.name)) return null
      if (!Array.isArray(entry.devices) || entry.devices.length > 32) return null
      if (!entry.devices.every((d) => typeof d === 'string' && d.length > 0 && d.length <= 64)) return null
      out[playerId] = { name: entry.name, devices: [...new Set(entry.devices)] }
    }
    return out
  }

  function rosterAdd(roster, playerId, name, device) {
    const entry = roster[playerId]
    const devices = entry ? entry.devices.filter((d) => d !== device) : []
    return { ...roster, [playerId]: { name, devices: [...devices, device] } }
  }

  /** a player leaves the roster with their last device */
  function rosterRemove(roster, playerId, device) {
    const entry = roster[playerId]
    if (!entry) return roster
    const devices = entry.devices.filter((d) => d !== device)
    const out = { ...roster }
    if (devices.length === 0) delete out[playerId]
    else out[playerId] = { ...entry, devices }
    return out
  }

  function rosterMerge(a, b) {
    let out = a
    for (const [playerId, entry] of Object.entries(b)) {
      for (const device of entry.devices) out = rosterAdd(out, playerId, entry.name, device)
    }
    return out
  }

  window.PartyVotes = {
    LIMITS,
    randomId,
    parseVote,
    createVote,
    merge,
    applyBallot,
    canEnd,
    tally,
    parseRoster,
    rosterAdd,
    rosterRemove,
    rosterMerge,
  }
})()
