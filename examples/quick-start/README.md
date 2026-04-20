# quick-start

Minimal seed for a new content_root. Copy these into a directory of
your own and start filing requests.

## Use

```bash
cp -r examples/quick-start/* /path/to/your/content_root/
cd /path/to/your/content_root/
GUILD_ACTOR=alice node /path/to/guild-cli/bin/gate.mjs boot
```

Edit `guild.config.yaml` to set your own `host_names`. Add or remove
members under `members/` as needed (`guild new --name <n>` or by hand).

For a fully populated content_root with real lifecycle examples, see
[`../dogfood-session/`](../dogfood-session/).
