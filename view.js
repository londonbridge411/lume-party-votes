// DOM helpers the panel and the popups share. Text always goes in through
// textContent, never markup, since questions and names come from other users.
;(function () {
  function el(tag, props, children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'text') node.textContent = value
      else if (key === 'onClick') node.addEventListener('click', value)
      else if (value === true) node.setAttribute(key, '')
      else if (value !== false && value != null) node.setAttribute(key, value)
    }
    for (const child of children || []) if (child) node.appendChild(child)
    return node
  }

  /** player id -> display name, from the main frame's state */
  function namer(state) {
    const names = new Map(((state && state.members) || []).map((m) => [m.playerId, m.displayName]))
    return (playerId) => names.get(playerId) || 'Someone'
  }

  /** an ended vote: each option with its count and, for a named vote, who picked it */
  function renderResult(vote, nameOf) {
    const rows = window.PartyVotes.tally(vote)
    const total = Object.keys(vote.ballots).length
    const top = Math.max(0, ...rows.map((r) => r.count))
    const ender = vote.endedBy && vote.endedBy !== vote.starter ? `, ended by ${nameOf(vote.endedBy)}` : ''

    return [
      el('h4', { text: 'Result' }),
      el('p', { class: 'question', text: vote.question }),
      el('p', {
        class: 'meta',
        text: `Started by ${nameOf(vote.starter)}${ender}. ${total} ${total === 1 ? 'vote' : 'votes'}`,
      }),
      el(
        'div',
        { class: 'results' },
        rows.map((row) =>
          el('div', { class: 'result' + (top > 0 && row.count === top ? ' top' : '') }, [
            el('div', { class: 'result-head' }, [
              el('span', { class: 'result-label', text: row.label }),
              el('span', { class: 'result-count', text: String(row.count) }),
            ]),
            el('div', { class: 'bar' }, [
              el('span', { style: `width: ${total > 0 ? Math.round((row.count / total) * 100) : 0}%` }),
            ]),
            row.voters.length > 0
              ? el('div', { class: 'names', text: row.voters.map(nameOf).sort((a, b) => a.localeCompare(b)).join(', ') })
              : null,
          ]),
        ),
      ),
    ]
  }

  window.PartyVotesView = { el, namer, renderResult }
})()
