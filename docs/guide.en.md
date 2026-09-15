# Configuration, backups, and recovery

[Back to README](../README.en.md) · [简体中文](guide.md)

## Installation settings

`launcher-config.json` in the launcher directory stores the DSH source and data paths selected during installation. These environment variables override the corresponding settings:

| Variable | Purpose |
| --- | --- |
| `DSH_LAUNCHER_REPO` | DSH source repository path |
| `DSH_HOME` | DSH data directory path |

Use absolute paths. If you move the launcher, DSH checkout, or data directory, close the selection window and rerun the installer to update configuration and the shortcut.

## File locations

These files are generated in the launcher directory:

| File or directory | Contents |
| --- | --- |
| `launcher-config.json` | Installation paths |
| `selection.json` | Selection saved when Start was last clicked |
| `check-cache.json`, `fingerprints.json` | Check results and file-change cache |
| `last-check.json` | Latest check report |
| `selected-plugins.yml` | Startup override for manually inserted extensions |
| `check-logs/` | Individual check logs |
| `launcher.log`, `dsh.stdout.log`, `dsh.stderr.log` | Launcher and main-service logs |
| `backups/` | Profile backups created before changes |

To run a complete recheck, click **强制重新检查** (Force recheck). Alternatively, close the selection window, delete `check-cache.json` and `fingerprints.json`, and reopen it.

Logs can contain local paths, plugin settings, and error context. Share only necessary excerpts and remove credentials and personal information.

## How startup saves configuration

After the selected combination passes validation, the launcher updates the Web profile's bundle list and uses `selected-plugins.yml` to override the enabled state of manually inserted extensions. Original YAML patches are preserved.

Before modifying the profile, it saves a copy in `backups/`. If the main startup fails, it attempts to restore the preceding configuration. If another program has changed the configuration in the meantime, the launcher preserves that change and reports an error instead of overwriting it.

## Restore the original loading list

1. Finish active tasks, stop DSH, and close the selection window.
2. Find the desired `profile-*.json` in the launcher's `backups/` directory and inspect its plugin list.
3. Back up the current `profiles/web/package.json` in your DSH data directory, then replace it with the selected backup.
4. Start DSH using its original command, without the launcher-generated override configuration.

These backups contain loading configuration, not plugin packages or DSH code. Restoring a loading list does not roll back software updates.

## Stop using the launcher

Delete the **Sental DSH Preflight** desktop shortcut to stop launching DSH through it. Before removing the launcher directory, stop related services and retain any needed backups and logs.

Deleting the shortcut or directory does not restore a previous plugin list automatically. Follow the restoration steps above first if needed.
