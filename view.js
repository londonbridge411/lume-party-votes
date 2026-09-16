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

  /** an ended vote: each option with its count and, for a named vote, who picked it */
  function renderResult(vote) {
    const rows = window.PartyVotes.tally(vote)
    const total = Object.keys(vote.ballots).length
    const top = Math.max(0, ...rows.map((r) => r.count))
    const ender = vote.endedBy && vote.endedBy.playerId !== vote.starter.playerId ? `, ended by ${vote.endedBy.name}` : ''

    return [
      el('h4', { text: 'Result' }),
      el('p', { class: 'question', text: vote.question }),
      el('p', {
        class: 'meta',
        text: `Started by ${vote.starter.name}${ender}. ${total} ${total === 1 ? 'vote' : 'votes'}`,
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
            row.names.length > 0 ? el('div', { class: 'names', text: row.names.join(', ') }) : null,
          ]),
        ),
      ),
    ]
  }

  window.PartyVotesView = { el, renderResult }
})()
