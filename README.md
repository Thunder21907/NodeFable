# NodeFable

A self-hosted, visual branching narrative editor for creating interactive fiction where every choice branches the story, changes the world, and shapes the outcome.

NodeFable gives you a node-graph canvas: drag passages around, draw connections between them, and see the entire shape of your story at a glance.

## Features

- **Visual node editor** -- drag, drop, and connect story nodes on an infinite canvas using Drawflow. See branching paths, dead ends, and loops emerge as you write.
- **Built-in narrative engine** -- variables, conditionals (`{if: state.hp > 0}`), inline mutations (`{set: state.gold += 10}`), timed wait sequences, and a HUD side panel. No plugins needed.
- **Live preview** -- click "Preview Game" to play your story in a new tab. Tweak, re-preview, repeat. Fast iteration without exporting.
- **Standalone export** -- export your story as a ZIP containing a single self-contained HTML file with inlined assets. Send it to friends, host it anywhere, no server required.
- **No database, no lock-in** -- everything is flat JSON files. Back them up with git, edit them by hand, own your data.
- **Asset management** -- upload and manage images through the editor UI. Assets are stored alongside your project files.

## Quick Start

Requires Python 3.9+.

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./run_dev.sh
```

This starts the server on `http://localhost:8005` and opens the editor in your browser.

## How It Works

Stories are composed of **nodes** (passages) connected by **choices**. Each node contains rich text content with markdown-style formatting. Writers use a lightweight syntax to create links between nodes, define variable mutations, and control conditional visibility.

A node's text can include:

- `[Go to forest](node:forest)` -- a choice link to another node
- `[Bribe guard](action:a0)` -- an action link that triggers variable changes
- `{if: state.gold >= 10}Rich!{else}Broke.{endif}` -- conditional text
- `{set: state.hp -= 10}` -- inline variable mutation
- `{wait:2000}...{endwait}` -- timed fade sequences
- `{var:state.player_name}` -- variable interpolation
- `![portrait](assets/alex.png){img:w=200}` -- images with optional dimensions

Variables, choices, actions, and on-enter redirects give you the building blocks for complex interactive narratives: stat checks, branching dialogue, timed events, shops, combat, and more.

## Tech Stack

- **Backend:** Python, FastAPI, uvicorn
- **Frontend:** Vanilla JavaScript, Drawflow 0.0.60
- **Storage:** Flat JSON files (no database)
- **Dependencies:** fastapi, uvicorn[standard], python-multipart

## Project Structure

```
NodeFable/
  backend/
    main.py              -- FastAPI server (API endpoints)
    schemas/
      project.py         -- Pydantic models for project data
    data/                -- Project files (gitignored)
  frontend/
    editor/
      index.html         -- Editor application page
      app.js             -- Editor logic (Drawflow, state management)
      template.html      -- Export/preview game template
      template_styles.css-- Styles for exported games
      styles.css         -- Editor styles
      tutorial.html      -- In-editor tutorial
  docs/                  -- Technical documentation
  features/              -- Feature implementation plans
  run_dev.sh             -- Development server launcher
  requirements.txt       -- Python dependencies
```

## License

MIT -- see [LICENSE](LICENSE) for details.
