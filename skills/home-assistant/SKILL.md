---
id: home-assistant
name: Home Assistant
description: Control and query Home Assistant via simple commands. Uses HA_URL and HA_TOKEN from ~/.cowcode/.env. Use command: "list lights", "search kitchen", "on light.xyz", "list automations", etc. See SKILL.md.
---

# Home Assistant

Control and query your **Home Assistant** instance with simple commands. You do not need to say "entities", "domain", or "state"—use the command phrases below and the skill will run the right action.

**Config:** Set **HA_TOKEN** in `~/.cowcode/.env` (e.g. via `cowcode skills install home-assistant`). **HA_URL** is optional and defaults to `http://localhost:8123`. Add `"home-assistant"` to `skills.enabled` in config.

## How to use

Set **`arguments.command`** to one of the commands below. The user can speak naturally; you translate their intent into a single `command` string.

## Commands (use `arguments.command`)

| Command | When to use | Example |
|---------|-------------|---------|
| `list lights` | List all lights | "What lights do I have?", "Show my lights" |
| `list automation` | List all automations | "List my automations", "Show thermostat automations" |
| `list switch` | List switches | "What switches are there?" |
| `list` | List all entities | "List all devices" |
| `search <word>` | Find entities by name | "Find kitchen lights" → `search kitchen` |
| `state <entity_id>` | Get one entity's state | "Is the living room light on?" → `state light.living_room` |
| `on <entity_id>` | Turn on a light/switch | "Turn on the living room light" → `on light.living_room` |
| `on <entity_id> <0-255>` | Turn on with brightness | "Set kitchen light to 50%" → `on light.kitchen 128` |
| `off <entity_id>` | Turn off | "Turn off the bedroom light" → `off light.bedroom` |
| `toggle <entity_id>` | Toggle on/off | "Toggle the fan" → `toggle switch.fan` |
| `scene <entity_id>` | Activate a scene | "Movie mode" → `scene scene.movie_night` |
| `script <entity_id>` | Run a script | "Run good night script" → `script script.good_night` |
| `automation <entity_id>` | Trigger an automation | "Run my morning automation" → `automation automation.morning` |
| `climate <entity_id> <temp>` | Set thermostat temperature | "Set thermostat to 22" → `climate climate.thermostat 22` |
| `help` | List all commands | When the user asks how to use Home Assistant |

## User says → command (translate intent)

| User says | Use command |
|-----------|-------------|
| List my lights / What lights do I have? | `list lights` |
| Show my automations / Thermostat automations | `list automation` |
| Find something (e.g. kitchen, thermostat) | `search kitchen` or `search thermostat` |
| Turn on the living room light | `on light.living_room` |
| Turn off the bedroom light | `off light.bedroom` |
| Is the garage door open? | `state cover.garage_door` |
| Run my "good night" script | `script script.good_night` |
| Trigger morning automation | `automation automation.morning` |
| Set temperature to 21 | `climate climate.thermostat 21` (use the correct thermostat entity_id from a prior list/search) |

## Finding entity IDs

If the user mentions a room or device by name and you don't know the entity_id:
1. Use **`search <name>`** (e.g. `search living_room`) to get matching entities and their `entity_id`.
2. Then use **`on`**, **`off`**, **`state`**, etc. with that `entity_id`.

## Notes

- Entity IDs are `domain.name` (e.g. `light.living_room`, `automation.morning`). Use `list` or `search` to discover them.
- For raw API calls use: `call <domain> <service> [entity_id]` (advanced).
