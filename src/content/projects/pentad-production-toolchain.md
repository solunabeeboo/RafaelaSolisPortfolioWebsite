---
title: "Pentad Production Toolchain"
hook: "A self-hosted production suite for Pentad Games: kanban tracking, an art critique hub, AI meeting notes, and nightly builds."
visibility: "public"
featured: true
order: 4
disciplines: ["production","programming"]
studio: "Pentad Games"
role: "Product Owner, builder"
status: "In use by the studio"
image: "/projects/images/503815079-d1d027ba-d380-4e18-993c-73600280d486.webp"
media: [
  "/projects/images/503815079-d1d027ba-d380-4e18-993c-73600280d486.webp",
  "/projects/screenshots/Screenshot 2026-03-14 154847.webp",
  "/projects/screenshots/Screenshot 2026-03-14 154618.webp"
  ]
links: [
  {"label":"Earlier version: Discord + Taiga bot on GitHub","url":"https://github.com/solunabeeboo/Discord-Taiga-Integration-with-Webhooks"}
  ]
tags: ["AFFiNE","Self-hosted","GitHub Actions","Kanban","Python","Agile / Scrum"]
contribution: [
  "Designed and built the studio’s production suite on a self-hosted AFFiNE instance with its own storage",
  "Built kanban embed tools tracking story points, completion, and assignees, with automated email reminders",
  "Built an art hub that auto-generates pages, stores art centrally, and runs critique rounds with reminders",
  "Introduced local, on-device AI meeting transcription and notes",
  "Built a GitHub integration for recent changes, file-tree browsing, repo zip downloads, and nightly Unity builds via GitHub Actions"
  ]
todo: ["Add screenshots of the AFFiNE suite (current media is the earlier Taiga bot)","Write Design / Process sections"]
---

## Technical notes

- Self-hosted AFFiNE workspace with its own storage instance
- Kanban embed tools tracking story points, completion, and assignees, with email reminders
- Art hub that auto-generates pages, stores art centrally, and runs critique rounds with reminders
- Local, on-device AI meeting transcription and notes
- GitHub integration: recent changes, file-tree browser, repo zip download, and nightly Unity builds via GitHub Actions

## Process

The earlier version was a Discord bot integrated with Taiga that posted weekly sprint breakdowns and task reminders. Specifically, this is an example of a tool I made that read our Taiga board (Jira Alternative), and posted automated daily standups for an asynchronous workflow. It generated its won board image using what it read and Github Actions to help facilitate teamwork.
