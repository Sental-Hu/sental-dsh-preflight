# Development requirements

This launcher and plugin preflight tool is intended for open-source distribution.

- Keep changes focused, responsibilities clear, errors actionable, and regression tests tied to observable behavior.
- Support different user environments and DSH versions where practical. Prefer capability detection, configurable paths, and isolated host adapters. Document platform-specific requirements and do not hard-code a developer's environment.
- After each local update, run relevant automated checks and exercise the actual launcher with local DSH, including startup health, plugin loading, changed behavior, and a basic conversation. Push commits or tags and publish packages only after these checks pass.
- Record tool and host versions, operating system, browser, actions, and results. Distinguish unit or simulated checks from real UI validation; do not claim untested environments have passed.
- If local DSH validation fails, fix and retest. If blocked, retain changes locally and report the blocker without pushing. Preserve user sessions, configuration, data, and a recoverable previous installation.
- Keep personal paths, credentials, conversation content, and runtime logs out of the repository.
