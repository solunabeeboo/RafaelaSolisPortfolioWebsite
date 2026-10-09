---
title: Scrum Facilitation
hook: The production suite I built for Pentad Games, with self-hosted AFFiNE, kanban tracking, art critiques, meeting notes, and nightly builds.
visibility: public
featured: true
order: 4
disciplines:
  - production
  - programming
studio: Pentad Games
role: Product Owner; designed and built the tools
kind: tool
engine: AFFiNE (self-hosted), Python, GitHub Actions
duration: Ongoing
status: In use by the studio
image: /vault-media/projects/scrum-facilitation/screenshot-2026-03-14-154618.webp
media:
  - src: /vault-media/projects/scrum-facilitation/503815079-d1d027ba-d380-4e18-993c-73600280d486.webp
    alt: Discord Screenshot
  - src: /vault-media/projects/scrum-facilitation/screenshot-2026-03-14-154847.webp
    alt: Code Screen Shot of the Action Workflow
  - src: /vault-media/projects/scrum-facilitation/screenshot-2026-03-14-154618.webp
    alt: Discord Screenshot of the compiled Kanban board for the Sprint
links:
  - label: View Example on GitHub
    url: https://github.com/solunabeeboo/Discord-Taiga-Integration-with-Webhooks
tags:
  - Scrum
  - Agile
  - Python
  - AFFiNE
  - Self-hosted
  - GitHub Actions
contribution:
  - Designed and built Pentad Games' production suite on a self-hosted AFFiNE instance with its own storage
  - Built kanban embed tools tracking story points, completion, and assignees, with automated email reminders so tasks stop slipping
  - Built an art hub that auto-generates pages, stores art centrally, and runs critique rounds with reminders so feedback stops getting lost in chat
  - Introduced local, on-device AI meeting transcription and notes
  - Built a GitHub integration for recent changes, file-tree browsing, repo zip downloads, and nightly Unity builds via GitHub Actions, so non-programmers can test the latest build without Git
problem: The team needed tasks to stop slipping, feedback to stop getting lost in chat, and a way for non-programmers to test the latest build without Git.
goal: Give the studio a production toolchain that fits how an Agile/Scrum game team actually works.
year: "2025"
---

I built the production tools Pentad Games uses to run Agile/Scrum. I am the product owner, and I designed and built the tools myself.

## Pentad Games production suite

- Self-hosted AFFiNE workspace with its own storage instance
- Kanban embed tools tracking story points, completion, and assignees, with email reminders so tasks stop slipping
- Art hub that auto-generates pages, stores art centrally, and runs critique rounds with reminders so feedback stops getting lost in chat
- Local, on-device AI meeting transcription and notes
- GitHub integration: recent changes, file-tree browser, repo zip download, and nightly Unity builds via GitHub Actions, so non-programmers can test the latest build without Git

## Discord + Taiga bot

Before the AFFiNE suite, I made a tool that read our Taiga board (a Jira alternative) and posted automated daily standups for an asynchronous workflow. It generated its own board image from what it read, and used GitHub Actions to help facilitate teamwork. It also posted weekly sprint breakdowns.

## Challenges

Balancing tool complexity with practical use and the various APIs needed.

## Outcome and lessons

This project deepened my understanding of team dynamics and the practical challenges of implementing agile methodologies.
