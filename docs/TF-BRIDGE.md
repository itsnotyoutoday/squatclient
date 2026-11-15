# TinyFugue and the TinyFugue bridge (`tf-squatterd`)

Moved from the README. If you use [gtf](https://github.com/itsnotyoutoday/gtf) (GoTinyFugue, which has the same squatter built in) you do not need any of this: see the README quickstart.

If you already run [TinyFugue](https://github.com/ingwarsw/tinyfugue) in `screen` or `tmux`, it can be paired with
SquatClient the same way: you see all of TinyFugue's connections (history, then live), type into them, edit its world
list, and take the keyboard from, share it with, or hand it back to the TinyFugue terminal. TinyFugue keeps
running its own triggers.

The pieces: a TinyFugue build with the squat support (branch `squatterbridge` of the fork below) and the helper
`tf-squatterd`, which TinyFugue starts as its own child process. Nothing in TinyFugue listens on the network.

**1. Get and build TinyFugue (the fork with squat support)**

```sh
git clone -b squatterbridge https://github.com/itsnotyoutoday/tinyfugue.git
cd tinyfugue
./configure --prefix="$HOME/.local" --enable-gmcp --enable-msdp
make && make install
```

`--enable-gmcp` and `--enable-msdp` let the client see GMCP and MSDP data from games (MSDP needs `flex`).
TinyFugue also needs a C toolchain, OpenSSL and the ICU libraries (`libicu-dev`) as usual. On macOS, if linking
fails with missing `utext_*` / `ucnv_*` symbols, add `-licuuc` to `LIBS` in `src/Makefile` and run `make` again.
Make sure `~/.local/bin` is on your `PATH`.

**2. Build the bridge helper**

```sh
git clone https://github.com/itsnotyoutoday/squatClientDaemon.git     # skip if you already have it
cd squatClientDaemon && make build                                    # produces ./tf-squatterd
install -m 755 tf-squatterd ~/.local/bin/                             # anywhere on PATH
```

(or leave it where it is and tell TinyFugue: `/set squat_bin=/full/path/to/tf-squatterd`)

**3. Start it from TinyFugue**

Run TinyFugue, preferably inside `tmux new -s tf`, so it keeps running when you log out:

```
/squat on                    start the bridge (127.0.0.1:10328, TLS)
/squat pair                  print a one-time pairing code and the TLS fingerprint
```

`/squat pair operator` or `admin` pairs with a higher role (default: `operator`, which can type and open
connections; `admin` can also edit worlds' macro files, run allowed commands and upload scripts).

**4. Pair SquatClient**

**Cloud button → Squatters → Add a squatter**, Type **TinyFugue**, the host, port **10328** and the code. Compare the
fingerprint with the one TinyFugue printed, then **Trust and pair**. Your TinyFugue connections appear as tabs
marked **(tf)**. If TinyFugue runs on another machine, either set `/set squat_bind=0.0.0.0` before `/squat on` (and
open the port), or leave it on loopback and tunnel it: `ssh -N -L 10328:127.0.0.1:10328 you@server`, then add the
squatter as host `127.0.0.1`.

**Who has the keyboard.** Each TinyFugue connection has two switches, shown on its tab and in the status bar:
*input* (TinyFugue only / both / SquatClient only) and *automation* (whose triggers run). Set them from the app,
or in TinyFugue with `/control`. By default a paired operator can take over; `/set squat_takeover=ask` makes
TinyFugue ask you first (`/control allow`, `/control deny`). `/control <world> tf` always takes a world back, and
everything reverts to TinyFugue when the app disconnects.

**Settings** are ordinary TinyFugue variables, set before `/squat on`: `squat_port` (10328), `squat_bind`
(127.0.0.1), `squat_dir` (`~/.tf-squatter`), `squat_takeover` (`auto`, `ask`, `off`), `squat_exec` and
`squat_scripts` (both **off** by default; remote commands and uploaded scripts for admin devices; leave them off
unless you need them: `squat_exec=on` is the same as a shell on that account) and `squat_mtts`. The full list, the
control model and the security notes are in TinyFugue's `README.squat.md`.

Games must be read while in the background: keep TinyFugue's `/set background=on` (the default).

## TinyFugue scripting and the remote TinyFugue

Typed `/commands` are answered by SquatClient's own script engine, also on sessions that run through a remote
TinyFugue; plain text goes to the game as typed. To run one command in the remote TinyFugue itself, prefix it
with `/tf` (`/tf /def ...`; admin device, `squat_exec` on); `/local cmd` forces the local engine past Lua aliases,
and `/stop` interrupts a runaway script. The desktop app runs scripts unrestricted by default; start it more
tightly with `SQUATCLIENT_TF_RESTRICT=shell|file|world`. Details: the daemon repository's `docs/TF-ENGINE.md`,
`docs/TF-ROUTING.md` and `docs/COMMAND-STATUS.md`.
