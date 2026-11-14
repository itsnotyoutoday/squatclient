;;; squatclient-hide.tf: keep SquatClient's own queries off TinyFugue's screen.
;;;
;;; SquatClient (the Object Editor, game type detection...) asks the game questions through TinyFugue
;;; and reads the answers itself. TinyFugue shows those answers on its own screen too, unless it is
;;; told otherwise. This file hides them there. Nothing is lost: gagged lines still reach SquatClient
;;; and TinyFugue's history (/recall).
;;;
;;; Load it from your TinyFugue config (tfsquatrc or .tfrc):   /load /path/to/squatclient-hide.tf
;;; or send it from SquatClient (Squatters > Scripts), where "safe" mode is enough.

; every marker and data line of a query carries the unique prefix SQUATCAP-: always hide those
/def -F -ag -i -t"*SQUATCAP-*" sqcap_hide_data

; remember that a query is running, from its BEGIN line to its END line (or 8 seconds at most)
/def -F -i -t"*SQUATCAP-*-BEGIN" sqcap_begin = /set sqcap_active=1%; /repeat -8 1 /set sqcap_active=0
/def -F -i -t"*SQUATCAP-*-END" sqcap_end = /set sqcap_active=0

; the game's refusals to those queries are hidden only while a query is running, so the same
; messages in answer to your own commands still show, and so does any chat in between
/def -F -ag -i -E"sqcap_active" -t"I can't see that*" sqcap_hide_refusal1
/def -F -ag -i -E"sqcap_active" -t"I don't see that*" sqcap_hide_refusal2
/def -F -ag -i -E"sqcap_active" -t"Couldn't find that*" sqcap_hide_refusal3
/def -F -ag -i -E"sqcap_active" -t"I can't find*" sqcap_hide_refusal4
/def -F -ag -i -E"sqcap_active" -t"I don't know which one*" sqcap_hide_refusal5
/def -F -ag -i -E"sqcap_active" -t"Huh?*" sqcap_hide_refusal6
