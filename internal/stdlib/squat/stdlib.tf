;;;; SquatClient standard library.
;;;;
;;;; This is NOT tf's lib/tf/stdlib.tf. tf's library is written for a terminal (a status line drawn
;;;; with escape codes, key bindings for line editing, visual mode, a /more pager, screen widths);
;;;; a webview client has none of that, and the engine (gtfparser) already implements most of the
;;;; library's commands natively (/list*, /purge*, /echo, /require, /first, ...).  What is left is
;;;; the part that is script: worlds, world types and login hooks, file shortcuts, hilite helpers,
;;;; plus the GUI mappings and the graphics language.  docs/LIB.md says what was kept, dropped,
;;;; replaced and why.
;;;;
;;;; Parts of this file are adapted from TinyFugue's lib/tf/stdlib.tf (Copyright Ken Keys;
;;;; TinyFugue is GPL licensed, as is SquatClient).
;;;;
;;;; Your own definitions belong in startup.tf; this file is rewritten when SquatClient starts.

/set squat_stdlib=1
/set squat_config_dir=@CONFIGDIR@

;;; High priority for library hooks.  (tf does this too: it is a hack, but a documented one.)
/set maxpri=2147483647

;;; ----------------------------------------------------------------------------- GUI behaviour
;;; A scrolling window does not page: output never waits for a key.
/set more=0

;;; ----------------------------------------------------------------------------- world types
;;; /addworld -Ttype ... decides how a world logs in.  The Worlds dialog stores the same type and a
;;; login template of its own; these hooks are the script side, for worlds a script defined and for
;;; engines that raise the LOGIN hook.  (SquatClient's own login runs from the world record, so a
;;; world defined in the dialog is logged in once, by the client.)

;; Default world type: tiny login format, no flags changed.
/def -mglob -T{} -hLOGIN -iFp'maxpri' ~default_login_hook = \
    /~login_hook_tiny

;; Tiny: login format "connect <char> <pass>", lp off.
/def -mglob -T{tiny|tiny.*} -hWORLD -iFp'maxpri' ~world_hook_tiny = \
    /set lp=0
/def -mglob -T{tiny|tiny.*} -hLOGIN -iFp'maxpri' ~login_hook_tiny = \
    /let _char=${world_character}%;\
    /if (strchr(_char, ' ') >= 0) /let _char="%_char"%; /endif%; \
    /let _pass=${world_password}%;\
    /if (strchr(_pass, ' ') >= 0) /let _pass="%_pass"%; /endif%; \
    /send connect %_char %_pass

;; Prompt worlds: lp on.
/def -mglob -Tprompt -hWORLD -iFp'maxpri' ~world_hook_prompt = \
    /set lp=1

;; LP, Diku, Aber: name and password on their own lines, lp on.
/def -mglob -T{lp|lp.*|diku|diku.*|aber|aber.*} -hWORLD -iFp'maxpri' ~world_hook_lp = \
    /set lp=1
/def -mglob -T{lp|lp.*|diku|diku.*|aber|aber.*} -hLOGIN -iFp'maxpri' ~login_hook_lp = \
    /send ${world_character}%; \
    /send ${world_password}

;; LP worlds with telnet end-of-prompt markers: lp off.
/def -mglob -T{lpp|lpp.*} -hWORLD -iFp'maxpri' ~world_hook_lpp = \
    /set lp=0
/def -mglob -T{lpp|lpp.*} -hLOGIN -iFp'maxpri' ~login_hook_lpp = \
    /send ${world_character}%; \
    /send ${world_password}

;; Telnet: answers the login: and password: prompts, lp on, local echo off at the password prompt.
/def -mglob -T{telnet|telnet.*} -hCONNECT -iFp'maxpri' ~con_hook_telnet =\
    /def -w -qhPROMPT -n1 -iFp'maxpri-1' = /localecho on
/def -mglob -T{telnet|telnet.*} -hWORLD -iFp'maxpri' ~world_hook_telnet =\
    /set lp=1
/def -mglob -T{telnet|telnet.*} -hLOGIN -iFp'maxpri' ~login_hook_telnet =\
    /def -n1 -ip'maxpri' -mregexp -w -h'PROMPT login: *$$' \
      ~telnet_login_${world_name} = \
        /send $${world_character}%; \
    /def -n1 -ip'maxpri' -mregexp -w -h'PROMPT password: *$$' \
      ~telnet_pass_${world_name} = \
        /send $${world_password}
/def -mregexp -T'^telnet(\\..*)?$' -h'PROMPT password: *$' -iFp'maxpri-1' \
  ~telnet_passwd = \
    /@test prompt(strcat({PL}, {P0}))%;\
    /def -w -q -hSEND -i -n1 -Fp'maxpri' ~echo_${world_name} =\
        /localecho on%;\
    /localecho off

;;; ----------------------------------------------------------------------------- world helpers
/def -i addtiny   = /addworld -T"tiny"   %*
/def -i addlp     = /addworld -T"lp"     %*
/def -i addlpp    = /addworld -T"lpp"    %*
/def -i adddiku   = /addworld -T"diku"   %*
/def -i addtelnet = /addworld -T"telnet" %*
/def -i purgeworld = /unworld $(/@listworlds -s %*)

;; /telnet host [port]: define a telnet world and connect to it.
/def -i telnet = \
    /addtelnet %{1},%{2-23} %1 %{2-23}%; \
    /connect %{1},%{2-23}

;; /retry world [seconds]: keep trying to connect until it works.   /retry_off [world]
/def -i retry = \
    /def -mglob -p'maxpri' -F -h'CONFAIL $(/escape ' %1) *' ~retry_fail_%1 =\
        /repeat -w -%{2-60} 1 /connect %1%;\
    /def -mglob -n1 -p'maxpri' -F -h'CONNECT $(/escape ' %1)' ~retry_succ_%1=\
        /undef ~retry_fail_%1%;\
    /connect %1
/def -i retry_off = /purge -mglob {~retry_fail_%{1-*}|~retry_succ_%{1-*}}

;;; ----------------------------------------------------------------------------- files
;;; tf's default file names live in the user's home; here they live with the rest of the client's files.
/set TINYPREFIX=@CONFIGDIR@/
/set TINYSUFFIX=.tf
/eval /def -i MACROFILE = %{TINYPREFIX}macros%{TINYSUFFIX}
/eval /def -i HILITEFILE = %{TINYPREFIX}hilite%{TINYSUFFIX}
/eval /def -i GAGFILE = %{TINYPREFIX}gag%{TINYSUFFIX}
/eval /def -i TRIGFILE = %{TINYPREFIX}trig%{TINYSUFFIX}
/eval /def -i BINDFILE = %{TINYPREFIX}bind%{TINYSUFFIX}
/eval /def -i HOOKFILE = %{TINYPREFIX}hook%{TINYSUFFIX}
/eval /def -i WORLDFILE = %{TINYPREFIX}world%{TINYSUFFIX}
/eval /def -i LOGFILE = %{squat_config_dir}/logs/tiny.log

/def -i ~def_file_command = \
    /def -i %1%2 = \
        /%1 %%{1-$${%{3}FILE}} %{-3}

/~def_file_command load def     MACRO
/~def_file_command load hilite  HILITE
/~def_file_command load gag     GAG
/~def_file_command load trig    TRIG
/~def_file_command load bind    BIND
/~def_file_command load hook    HOOK
/~def_file_command load world   WORLD
/~def_file_command save def   MACRO -mglob -h0 -b{} -t{} ?*
/~def_file_command save gag   GAG   -mglob -h0 -b{} -t -ag
/~def_file_command save trig  TRIG  -mglob -h0 -b{} -t -an
/~def_file_command save bind  BIND  -mglob -h0 -b
/~def_file_command save hook  HOOK  -mglob -h

/def -i savehilite = \
    /save %{1-${HILITEFILE}} -mglob -h0 -b{} -t -aurfdhbBC0%;\
    /save -a %{1-${HILITEFILE}} -mglob -h0 -t -P

/def -i loadhist = \
    /let _file=%L%; \
    /quote -S /recordline %-L '%%{_file-${LOGFILE}}

/def -i sys = /quote -S -decho \\!!%{*-:}
/def -i man = /help %*
/def -i cd  = /lcd %{*-%HOME}
/def -i pwd = /last $(/@lcd)

;;; ----------------------------------------------------------------------------- display helpers
;;; (the engine implements /wrap /nowrap /wrapspace; the window reads wrap, wrapsize and wrapspace)
/def -i ~do_prefix = \
    /if ( {-1} =/ "{|off|0|on|1}" ) \
        /set %{1}echo %{-1}%; \
    /elseif ( {-1} =/ "{all|2}" & {1} =~ "m" ) \
        /set %{1}echo %{-1}%; \
    /else \
        /set %{1}prefix=%{-1}%; \
        /set %{1}prefix%; \
        /set %{1}echo=1%; \
    /endif
/def -i kecho = /~do_prefix k %*
/def -i mecho = /~do_prefix m %*
/def -i qecho = /~do_prefix q %*

;;; Hilites for pages and whispers (tf's simulation of the old /hilite page and /hilite whisper).
/def -i hilite_whisper = \
    /def -ip2 -ah -mregexp -t'^[^ ]* whispers,? ".*" (to [^ ]*)?$$' ~hilite_whisper1
/def -i hilite_page = \
    /def -ip2 -ah -mglob -t'{*} pages from *[,:] *' ~hilite_page1%;\
    /def -ip2 -ah -mglob -t'You sense that {*} is looking for you in *' ~hilite_page2%;\
    /def -ip2 -ah -mglob -t'The message was: *' ~hilite_page3%;\
    /def -ip2 -ah -mglob -t'{*} pages[,:] *' ~hilite_page4%;\
    /def -ip2 -ah -mglob -t'In a page-pose*' ~hilite_page5
/def -i nohilite_whisper = /purge -mglob -I ~hilite_whisper[1-9]
/def -i nohilite_page    = /purge -mglob -I ~hilite_page[1-9]

;;; ----------------------------------------------------------------------------- terminal-only: replaced
;; A terminal's visual mode, pager and screen-region keys have no counterpart in a window.
/def -i visual = /echo -e %% The window is always split into output, status bar and input line; /visual only records the setting.%; /set visual=%{1-on}
/def -i more   = /echo -e %% Output never pauses in a scrolling window (use the scrollback).

;;; ----------------------------------------------------------------------------- GUI commands
;;; These open the app's own windows (the "dialog" event).  /listworlds, /world and /addworld typed alone
;;; already open the Worlds dialog; /help opens the help browser.
/def -i worlds       = /_ui worlds
/def -i quickconnect = /_ui quick
/def -i settings     = /_ui settings
/def -i layouts      = /_ui layouts
/def -i history      = /_ui history
/def -i about        = /_ui about
/def -i squatters    = /_ui squatters

;;; ----------------------------------------------------------------------------- graphics
/load -q gfx.tf

;;; /gfxdemo: a short TF script driving /gfx (loaded on first use).  The LCARS console, /lcars, is the Lua plugin squat-gfx.
/def -i gfxdemo = /load -q gfxdemo.tf%; /gfxdemo %*

;;; gtf's /layout and /panel (the terminal client's panel language) drawn by the graphics layer
/load -q gtfcompat.tf

/loaded squat/stdlib.tf
