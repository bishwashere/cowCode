---
id: home-assistant
name: Home Assistant
description: Control and query Home Assistant. Uses HA_URL and HA_TOKEN from environment. Actions: list_states, get_state, call_service. See SKILL.md.
---

# Home Assistant

Control and query your **Home Assistant** instance over the REST API. Use when the user asks to turn lights on/off, check device states, run automations, or control any Home Assistant entity.

**Config:** Set **HA_TOKEN** in the environment (e.g. in `~/.cowcode/.env` via `cowcode skills install home-assistant`). **HA_URL** is optional and defaults to `http://localhost:8123`; set it only if your Home Assistant is at a different URL. Add `"home-assistant"` to `skills.enabled` in config.

## Commands (use `command` or `arguments.action`)

- **list_states** — List all entities (or filter by domain). Use when the user asks "what devices do I have?", "list my lights", "show entities". Optional: `arguments.domain` (e.g. `light`, `switch`, `sensor`) to filter.
- **get_state** — Get one entity's state. Set `arguments.entity_id` (e.g. `light.living_room`). Use when the user asks "is the living room light on?", "what's the temperature in the office?".
- **call_service** — Call a Home Assistant service. Set `arguments.domain`, `arguments.service`, and optionally `arguments.entity_id`, `arguments.service_data` (object). Examples: turn on a light (`domain: light`, `service: turn_on`, `entity_id: light.living_room`), toggle (`service: toggle`), run a script (`domain: script`, `service: turn_on`, `entity_id: script.notify_me`).

## Examples

| User says | Action | Arguments |
|-----------|--------|-----------|
| Turn on the living room light | call_service | domain: light, service: turn_on, entity_id: light.living_room |
| Turn off bedroom light | call_service | domain: light, service: turn_off, entity_id: light.bedroom |
| List all lights | list_states | domain: light |
| Is the garage door open? | get_state | entity_id: cover.garage_door |
| Run my "good night" script | call_service | domain: script, service: turn_on, entity_id: script.good_night |

## Notes

- Entity IDs are usually `domain.name` (e.g. `light.living_room`, `switch.coffee_machine`). Use list_states first if the user is unsure of entity IDs.
- For call_service, `service_data` can include any extra parameters (e.g. `brightness_pct`, `rgb_color`) as a JSON object.
