;;;; /gfx and /canvas: the graphics commands (docs/GFX.md).
;;;;
;;;; The commands themselves (_gfx, _canvas, _ui) are the client's: with the desktop app they reach the
;;;; renderer through /notify (internal/app/gfxbridge.go); a host that registers them natively sets
;;;; squat_gfx_native=1 and the bridges below are not defined.  This file adds what is script:
;;;; the user-facing names and the variable sync that feeds data bindings.

/loaded gfx.tf

/if (squat_gfx_native !~ "1") \
    /def -i _gfx    = /notify @gfx|${world_name}|%*%; \
    /def -i _canvas = /notify @canvas|${world_name}|%*%; \
    /def -i _ui     = /notify @ui|%*%; \
/endif

;; /gfx watch NAME...   TF variables the renderer may bind to (data binding)
;; /gfx unwatch [NAME...]
;; /gfx sync            push the watched variables (those that changed reach the renderer)
;; /gfx autosync [off]  keep syncing about ten times a second
;; anything else goes to the renderer
/set gfx_watch=
/set gfx_auto=0
/set gfx_gen=0

/def -i gfx = \
    /if ({1} =~ "sync") /gfx_sync%; \
    /elseif ({1} =~ "watch") /gfx_watch %-1%; \
    /elseif ({1} =~ "unwatch") /gfx_unwatch %-1%; \
    /elseif ({1} =~ "autosync") /gfx_autosync %-1%; \
    /else /_gfx %*%; \
    /endif

/def -i canvas = /_canvas %*

/def -i gfx_watch = \
    /while ({#}) \
        /if (strstr(strcat(" ", gfx_watch, " "), strcat(" ", {1}, " ")) < 0) /set gfx_watch=%{gfx_watch} %{1}%; /endif%; \
        /shift%; \
    /done

/def -i gfx_unwatch = \
    /if ({#} == 0) /set gfx_watch=%; /else \
        /let _drop=%{*}%; \
        /let _keep=%; \
        /let _n=%{gfx_watch}%; \
        /while (regmatch("^ *([^ ]+)(.*)$", _n)) \
            /let _w=%{P1}%; \
            /let _n=%{P2}%; \
            /if (strstr(strcat(" ", _drop, " "), strcat(" ", _w, " ")) < 0) /let _keep=%{_keep} %{_w}%; /endif%; \
        /done%; \
        /set gfx_watch=%{_keep}%; \
    /endif

/def -i gfx_sync = \
    /let _n=%{gfx_watch}%; \
    /while (regmatch("^ *([^ ]+)(.*)$", _n)) \
        /let _n=%{P2}%; \
        /eval /_gfx _v %{P1} %%{%{P1}}%; \
    /done

/def -i gfx_autosync = \
    /if ({1} =~ "off" | {1} =~ "0") \
        /set gfx_auto=0%; \
    /else \
        /set gfx_auto=1%; \
        /set gfx_gen=$[gfx_gen + 1]%; \
        /gfx_tick %{gfx_gen}%; \
    /endif

/def -i gfx_tick = \
    /if (gfx_auto & {1} == gfx_gen) \
        /gfx_sync%; \
        /repeat -0:0:0.1 1 /gfx_tick %1%; \
    /endif
