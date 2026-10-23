# Gumo compatibility

The Gumo entry point uses the current upstream runtime with compatibility for existing scheduled jobs. It does not change site adapters, account selection, or business permissions.

`opencli` enables `OPENCLI_GUMO_COMPAT=1`: successful JSON results keep their original data shape, and the former `browser <session> <command>` spelling is accepted. Failure results keep upstream error handling. Set `OPENCLI_GUMO_COMPAT=0` for the native upstream interface, including its success envelope and `--session` option.

Browser commands default to `existing-window` placement. They require a normal window in the selected profile, create inactive tabs, keep selection logical, and do not create windows or tab groups. Ownership follows individual automation tabs through service-worker wakes; cleanup cannot take over user tabs. Recovery uses Chrome session storage and does not persist runtime tab IDs across browser or extension restarts.

`OPENCLI_TAB_PLACEMENT=owned-container` selects the upstream window policy explicitly. The `tabPlacement` option is also available through the browser API. `OPENCLI_WINDOW` takes precedence over `OPENCLI_BROWSER_WINDOW_MODE`. The transport honors `OPENCLI_BROWSER_COMMAND_TIMEOUT`, with an explicit command timeout taking precedence.

The existing read-only `tabs/snapshot` operation returns window/tab identifiers and visibility, without page content or debugger attachment. Focus emulation is available without changing native window or tab selection. Before-unload handling stays attached during background navigation and cleanup; the Taobao guard remains limited to its existing host allowlist.

Credential filling retains profile/host checks and an extension-origin allowlist. Unapproved extensions receive no credentials. Passive filling never submits a form. Operating-system clicks retain upstream hidden-page protection. No login action is needed to test these features: use isolated fixture credentials and mocked input.

Moving an unpacked extension changes its identity. Coordinate the path change with the owner, preserve each profile binding, and retain the previous extension and CLI target until rollback is no longer needed. Do not copy cookies, reset browser profiles, or broaden the credential allowlist to make an upgrade appear successful.

`OPENCLI_CONFIG_DIR` selects the profile and plugin runtime together, including plugin locks and monorepos. Unit tests use a fresh temporary runtime directory and remove it afterwards, so plugin-management fixtures cannot replace installed user plugins. This does not change the home directory.
