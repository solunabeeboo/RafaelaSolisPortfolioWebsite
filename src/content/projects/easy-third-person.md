---
title: Easy Third Person
hook: A third-person camera mod for Subnautica 2. Runner-up ($650) in CurseForge's Subnautica 2 Modding Contest, with 3,000+ downloads.
visibility: public
featured: true
order: 4
disciplines:
  - programming
  - design
role: Designer and programmer
engine: Unreal Engine 5 (UE4SS), C++ and Lua
kind: mod
year: "2026"
duration: June 2026
status: "Released: 2nd place internationally, $650 prize"
links:
  - label: Easy Third Person! on CurseForge
    url: https://www.curseforge.com/subnautica-2/ue4ss-mods/easy-third-person
  - label: Source on GitHub
    url: https://github.com/solunabeeboo/SN2ThirdPersonMod
  - label: Subnautica 2 Modding Contest results
    url: https://mod.curseforge.com/modding-contests/subnautica2
tags:
  - Unreal Engine 5
  - UE4SS
  - C++
  - Lua
  - Modding
  - Camera
contribution:
  - Designed and built a third-person camera mod for Subnautica 2 in C++ and Lua
  - Reverse-engineered UE4SS to implement custom systems inside Subnautica 2's modding framework
  - Added camera collision after playtesters saw the camera clip through walls
  - Planned, built, and shipped on a contest deadline, placing 2nd internationally ($650 prize)
problem: Playing Subnautica 2 in first person can feel claustrophobic.
goal: Ease the first-person claustrophobia and offer a more dynamic camera, without making players edit files to configure it.
iterations:
  - before: The third-person camera could pass straight through walls.
    finding: Playtesters saw the camera clip through walls.
    change: Added camera collision so the camera stays out of the geometry.
result: Runner-up (2nd of the contest's winners) in the CurseForge Subnautica 2 Modding Contest, with a $650 prize. 3,039 downloads as of 2026-10-07, and featured on CurseForge's main page banner for multiple weeks.
studio: Curseforge International Competition
team: Solo
platforms:
  - Unreal Engine
media:
  - src: /vault-media/projects/easy-third-person/1781464713937.webp
    alt: Subnautica 2 Modding Contest Home Page
  - src: /vault-media/projects/easy-third-person/1781799931901.webp
    alt: Winners Page Showcasing my mod winning 2nd place from community vote!
  - src: /vault-media/projects/easy-third-person/1781799932041.webp
    alt: My Mod feature prominently on the home page as the first result.
image: /vault-media/projects/easy-third-person/1781799931901.webp
---

## Design

Easy Third Person adds a third-person camera to Subnautica 2. I made it to ease the claustrophobia of first person and to give players a more dynamic camera. In third person it removes the mask-outline UI. All settings live in the game's normal settings menu, so players never edit Lua files.

"The Gold Mod": lets players transform into any creature in the game, and grants special abilities for each form. I'm planning to expand this into something that ties into the core gameplay loop.
> https://lnkd.in/giv3hWXG

"Easy Third Person!": adds a full third-person camera mode with a settings menu that integrates natively with the game's existing UI. This is the one that made the top 10, and voting is open now!
> https://lnkd.in/gS7T6gyE

## Process

Playtesters saw the camera clip through walls, so I added camera collision.

## Technical notes

The mod runs on UE4SS. The camera logic is written in Lua, and a small C++ DLL hooks the game's settings menu (Dear ImGui). The source is on GitHub.

## Outcome and lessons

Easy Third Person placed 2nd internationally in the CurseForge Subnautica 2 Modding Contest ($650) and was featured on CurseForge's main banner for multiple weeks. It had 3,039 downloads as of 2026-10-07.
