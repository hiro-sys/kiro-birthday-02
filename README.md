# Spark Room

Spark Room is a shared workspace where human teammates and a Kiro AI agent collaborate on product discovery.

A human creates and reviews work in the browser.

Purin, an AI product strategist running through Kiro and MCP, joins the same room to analyze tasks, propose ideas, and create PRD drafts.

All participants use the same shared server, activity log, and real-time updates.

## What Spark Room Demonstrates

- Human and AI collaboration in one shared room.
- A real-time board for problems, users, ideas, and decisions.
- Human-created agent tasks for questions, proposals, reviews, and PRD drafts.
- AI proposals that always start as `pending`.
- Human-only approval and rejection of AI proposals.
- AI-generated PRDs that always start as `draft`.
- Human-only PRD approval, return, editing, and Markdown export.
- An MCP bridge that lets Kiro participate as Purin without directly editing local data files.

## Architecture

```text
Human browser ─┐
               ├─ HTTP / Server-Sent Events ─ Spark Room Server
Kiro / Purin ── MCP stdio ─ Spark Room MCP Server ─ HTTP ┘
```

`RoomService` is the only component that updates shared room state.

The browser and the MCP server both use the shared server API.

Every write follows the same flow: input validation, state update, persistence, activity logging, and real-time notification.

## Technology Stack

| Area | Technology |
| --- | --- |
| Human workspace | React, Vite, TypeScript |
| Shared server | Node.js, TypeScript, HTTP, Server-Sent Events |
| Persistence | Local JSON store |
| Kiro integration | Model Context Protocol (MCP) TypeScript SDK |
| Validation | TypeScript types and Zod |

## Requirements

- Node.js 22 or later.
- npm 10 or later.
- Kiro with MCP support for the Purin collaboration demo.

## Install

```bash
npm ci
```

Use `npm install` instead if you intend to update dependencies.

## Run Locally

Start the shared server in one terminal.

```bash
npm run dev:server
```

Start the browser client in another terminal.

```bash
npm run dev:client
```

Open the client at <http://127.0.0.1:5173>.

The shared server listens on <http://127.0.0.1:8787> by default.

For local development, `npm run dev` starts both processes together.

```bash
npm run dev
```

## Quality Checks

Run TypeScript checks.

```bash
npm run check
```

Create production builds for the client and server.

```bash
npm run build
```

Start the compiled server after building.

```bash
npm run start:server
```

## Connect Kiro Through MCP

Add the following entry to your Kiro MCP configuration for this workspace.

```json
{
  "mcpServers": {
    "spark-room": {
      "command": "npm",
      "args": ["run", "mcp"],
      "env": {
        "SPARK_ROOM_SERVER_URL": "http://127.0.0.1:8787"
      },
      "disabled": false
    }
  }
}
```

Reconnect the Spark Room MCP server from the Kiro MCP Server view after changing the configuration.

The MCP server exposes these tools.

| Tool | Purpose |
| --- | --- |
| `join_workspace` | Join a room as an AI agent such as Purin. |
| `leave_workspace` | Change the AI agent status to left. |
| `read_workspace` | Read members, cards, messages, tasks, activities, and the PRD. |
| `list_agent_tasks` | Read agent tasks, optionally filtered by status. |
| `update_agent_task` | Start or complete an assigned task. |
| `post_agent_message` | Explain analysis, rationale, or required human decisions. |
| `propose_card` | Add a human-reviewable idea proposal. |
| `save_prd_draft` | Save a draft PRD for an assigned PRD task. |

## Demo Flow

The following flow works well for a short collaboration demo.

1. Create a room with a room name and a human display name.
2. Open the **Invite Purin** panel.
3. Copy the invitation and paste it into Kiro Chat to invite **Purin, your AI product strategist**.
4. Confirm that Purin appears in the participant list as an active AI agent.
5. In the **Purin Request** panel, create an **Idea Proposal** task and assign it to Purin when available.
6. Ask Kiro to continue with the new task if its previous task execution has already ended.
7. Purin reads the room, changes the task to `in_progress`, explains its rationale, and adds up to three `pending` proposals.
8. A human reviews every proposal and chooses **Approve** or **Reject**.
9. Create a **PRD Draft** task for Purin after the relevant ideas are approved.
10. Ask Kiro to continue with the PRD task when necessary.
11. Purin saves a PRD with the `draft` status using approved information only.
12. A human reviews, edits, approves, or returns the PRD.
13. Export an approved PRD by using **Export Markdown** in the PRD panel.

A task may be created before or after Purin joins the room.

If a task is created after Purin has joined, the browser does not automatically start or wake a completed Kiro session.

Send Kiro a follow-up instruction to read the room and continue with the new task.

## Collaboration Rules

Spark Room enforces these workflow rules.

- Human members and AI agents share the same room state and activity log.
- AI proposal cards always begin as `pending`.
- Only human members can approve or reject AI proposals.
- AI PRDs always begin as `draft`.
- Only human members can approve, return, or edit a PRD.
- Purin can add no more than three proposals for one proposal task.
- Purin must record its analysis and the next human decision in the room.
- A human must create the agent task that starts each piece of Purin work.

## Real-Time Updates

The browser subscribes to the room event stream through Server-Sent Events.

When a human or Purin changes the room, the server records an activity and notifies connected browser clients.

The browser then fetches the latest room state and updates the workspace.

## Local Data and Security Notes

This project is a local MVP.

The shared server does not implement authentication or authorization for a network-exposed deployment.

Do not enter secrets, personal data, or confidential product information into a local demo room.

The local room data file is stored at `data/spark-room.json`.

That file is intentionally ignored by Git.

The tracked `data/.gitkeep` file preserves the directory without publishing local room content.

For a hosted or multi-device deployment, add authentication, authorization, transport security, encryption at rest, and production-grade operational controls before using real data.

## Project Structure

```text
src/
  client/                 # React browser workspace
    components/
    lib/
  server/                 # Shared server, RoomService, REST API, and SSE
  mcp/                    # Spark Room MCP server and HTTP client
  shared/                 # Shared types and input validation
.kiro/
  specs/spark-room/       # Requirements, design, and implementation tasks
  steering/               # Purin behavior rules
data/
  .gitkeep                # Tracked empty-directory placeholder
```

## License

Spark Room is available under the [MIT License](LICENSE).
