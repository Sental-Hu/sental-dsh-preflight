# Security

The selector listens on IPv4 loopback and requires a random session token. Requests are checked for a matching Host and, when supplied, Origin. Keep the endpoint URL private.

Plugin checks execute installed code with the current user's permissions. Temporary directories isolate ordinary DSH state; they are not a sandbox. Use plugins you trust. Plugins can access files or services beyond the temporary directory, and explicitly configured credentials may still be passed to them.

Logs and backups may contain local paths, configuration values or access tokens. Runtime files are excluded by `.gitignore`. Before attaching a log to an issue, remove credentials and personal data.

For a vulnerability, use GitHub private vulnerability reporting when enabled. Avoid posting credentials or an exploitable private configuration in a public issue.
