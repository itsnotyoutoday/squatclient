;;;; /gfxdemo: a small TinyFugue script driving the graphics layer (the full LCARS console is Lua: /lcars).
;;;; The same scene in Lua is in docs/GFX.md.  /gfxdemo off closes it.
/loaded squat/gfxdemo.tf

/set gfx_level=30
/gfx watch gfx_level

/def -i gfxdemo_raise = \
    /set gfx_level=$[mod(gfx_level + 25, 125)]%; \
    /gfx sync%; \
    /echo -aBCcyan >>> level %gfx_level

/def -i gfxdemo_run = \
    /if ({1} =~ "off") /gfx close demo%; /break%; /endif%; \
    /gfx open demo w=800 h=450 bg=#05070d bloom=0.9 dock=top size=45%%; \
    /gfx clear demo%; \
    /gfx stars sky 0 0 800 450 300 seed=3 speed=0.03%; \
    /gfx rrect bar 40 40 300 48 r=24 fill="lin(90;#ff9900,#cc6600)" glow=0.4 shadow.blur=10 shadow.dy=5%; \
    /gfx circle orb 620 200 50 fill="rad(0.4,0.35,0.7;#ffffff,#66aaff,#102040)" glow=0.6%; \
    /gfx anim orb y=170..230 dur=1.6 ease=inOutSine loop=inf yoyo%; \
    /gfx text title 40 130 "TF CONTROLS THE GRAPHICS LAYER" size=34 weight=700 fill=#ffcc99%; \
    /gfx rect meter 40 200 10 24 r=12 fill=#99ccff glow=0.3%; \
    /gfx bind meter w max(10, gfx_level * 3) smooth=0.4%; \
    /gfx text lvl 360 212 "LEVEL {gfx_level|%d}" size=24 fill=#99ccff%; \
    /gfx button go 40 260 220 56 RAISE pill=true fill=#9999ff color=#000000 size=28 weight=700%; \
    /gfx state go hover fill=#ccccff scaleX=1.05 scaleY=1.05 dur=0.1%; \
    /gfx on go click /gfxdemo_raise%; \
    /gfx sync

/def -i gfxdemo = /gfxdemo_run %*
