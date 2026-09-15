# Local verification — 2026-09-15

This update adds repository development requirements for open-source quality, compatibility, and local DSH validation before pushing. Launcher runtime code is unchanged.

- Tool 0.1.0; Windows build 26200; Node.js 24.14.0; Edge 152.0.4191.66; DSH 0.1.5-rc.1 local build.
- All 12 Node tests passed.
- Applied the saved plugin selection and started DSH with the existing runtime launcher. Startup manifest and JavaScript-resource checks passed.
- With annotation 0.1.19 installed, actual browser conversations, overlapping annotations, sent-record editing, repeated references, deletion, and refresh persistence passed.

The DSH install command can reactivate installed bundles omitted from the selected bundle list. Reapplying the saved launcher selection restored the intended configuration before successful startup. The launcher stopped after its configured single recovery attempt on the earlier failed boot; a subsequent start followed correction of the configuration.

## Sental DSH Annotation 0.1.20 integration

- Repeated all 12 Node tests, runtime recovery tests, installation tests and process-cleanup tests successfully.
- Installed Sental DSH Annotation 0.1.20 and retained the previous plugin selection under its new package name.
- Actual Edge headless browser: independent plugin loading passed with 57 startup resources, then the launch button completed combination verification and formal DSH startup.
- A fresh model conversation, annotation creation and persistence after page reload passed. An older conversation retained its existing annotation.
- Launcher runtime code was unchanged.
