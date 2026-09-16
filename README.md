# Party votes

A campaign plugin for [Lume](https://lume-vtt.vercel.app). Anyone at the table
asks a question, everyone picks an option, and the result shows when the vote
ends.

- Anyone starts a vote: a question and 2 to 6 options, with names shown or
  hidden.
- One vote at a time. Everyone else gets a popup over the board to pick in,
  and can change their pick in the Party votes panel until the vote ends.
- Results stay hidden until the vote ends; while it's open, only the number
  of people who have voted shows.
- The person who started a vote ends it, and the DM can end any vote. The
  result pops up for everyone.

Votes aren't stored anywhere. Each device in the session keeps a copy, and a
device that loads asks the others for the current vote, so a vote survives
its starter refreshing. It's gone once everyone leaves.

## Install

Until Lume's plugin browser exists, a campaign's DM installs it with a
`campaign_plugins` row:

| Column | Value |
|---|---|
| `plugin_id` | `lume.party-votes` |
| `manifest_url` | `https://londonbridge411.github.io/lume-party-votes/manifest.json` |
| `granted` | `["ui:panel", "rpc"]` |

## Trust

Votes travel as open broadcasts between the devices in the session. A
modified client could cast a ballot for someone else, end a vote while
claiming to be the DM, or read who picked what. That's fine for a table vote,
but "Hide names" only hides names in the panel. It isn't a secret ballot.

## Files

| File | What |
|---|---|
| `manifest.json` | Id, panel, permissions |
| `main.html` | The main frame: holds the vote, talks to other devices, opens and closes the popup |
| `popup.html` | The vote popup: the question and one button per option |
| `result.html` | The result popup |
| `view.js` | DOM helpers and the result view the panel and popups share |
| `panel.html`, `panel.css` | The panel: start form, open vote, result |
| `votes.js` | Vote state and the pure functions both frames use |
| `lume-client.js` | Lume's protocol client, copied until the SDK is published |

Static files, no build step. To develop against a local Lume, serve this
folder with CORS headers (`npx http-server --cors -p 5500`) and point the
install row at that manifest URL.
