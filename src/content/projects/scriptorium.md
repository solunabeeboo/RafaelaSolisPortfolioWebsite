---
title: Scriptorium
hook: A dungeon crawler where you draw runes to attack, read by a neural network I trained on players' drawings.
visibility: public
featured: true
team: Team of 5
engine: Unity 6, C#, Python (TensorFlow, Keras)
image: /vault-media/projects/scriptorium/scriptorium.webp
media:
  - src: /vault-media/projects/scriptorium/scriptorium.webp
    alt: A first-person dungeon corridor with a square drawing box in the center, a red rune stroke drawn over a creature, and a similarity percentage and spell name in the top-left corner
    caption: Drawing a rune mid-combat; the HUD shows how closely the drawing matched a known spell
  - src: /vault-media/projects/scriptorium/scriptorium-1.webp
    alt: A dark first-person corridor with on-screen text explaining W/S to move forward and back and A/D to turn left and right
  - src: /vault-media/projects/scriptorium/scriptorium-5.mp4
    alt: Video of Game from start to testing
  - src: /vault-media/projects/scriptorium/scriptorium-2.webp
    alt: Hallway corner going into tutorial boss
  - src: /vault-media/projects/scriptorium/scriptorium-3.webp
    alt: Tutorial Boss
  - src: /vault-media/projects/scriptorium/scriptorium-4.webp
    alt: Tutorial Boss with Player Drawing
  - src: /vault-media/projects/scriptorium/scriptoriumlogo.webp
    alt: Scriptorium Logo
links:
  - label: Play on itch.io
    url: https://vellum-games.itch.io/project-dungeon
embed:
  type: widget
  url: https://itch.io/embed/3904438
tags:
  - Unity 6
  - C#
  - Python
  - Neural Network
  - Drawing Combat
  - Dungeon Crawler
  - Narrative
  - Action
  - Bloody
order: 2
disciplines:
  - design
  - programming
studio: Pentad Games (formerly Vellum Games)
role: Lead Designer, Lead Programmer
status: Demo, Development Paused
kind: studio
contribution:
  - Led design and programming on a team of 5
  - "Designed rune-drawing combat: players draw runes to attack"
  - Trained multiple iterations of a CNN in Python (TensorFlow, Keras) to recognize player-drawn runes
  - Retrained the CNN on playtesters' drawings after messy runes were misread
problem: Players draw their attacks by hand, and the network has to read sloppy drawings quickly enough that combat still feels responsive.
goal: Make drawing a rune the attack itself, with a neural network reading the drawing.
iterations:
  - before: Hand-drawn runes were recognized by an earlier version of the CNN.
    finding: In playtests, messy runes were misread.
    change: Retrained the CNN (TensorFlow, Keras) on samples drawn by players.
duration: 3 Months
platforms:
  - Windows
  - Web
  - MacOS
  - Linux
logo: /vault-media/projects/scriptorium/scriptoriumlogo.webp
year: "2025"
---

## Design

In Scriptorium you draw to attack. Instead of pressing a button to cast a spell, you draw a rune on screen, and a neural network I trained decides which spell it is. The HUD shows how closely your drawing matched a known spell. It is a first-person dungeon crawler with a narrative and a lot of blood.

## Process

I trained several versions of a convolutional neural network (CNN) in Python with TensorFlow and Keras. In playtests, messy runes kept getting misread, so I retrained the network on drawings from the people playing. The retrained network was built on how players actually draw.

## Technical notes

The game runs in Unity 6 and C#. The recognition model is trained in Python (TensorFlow, Keras).

## Challenges

Integrating neural network recognition for drawing input while maintaining responsive gameplay was extremely challenging.

## Outcome and lessons

Scriptorium reached a playable demo. It taught me a lot about putting machine learning into a game and about processing player input in real time.
