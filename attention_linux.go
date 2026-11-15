//go:build linux

package main

/*
#cgo pkg-config: gtk+-3.0
#include <gtk/gtk.h>

// the GTK calls must run on the GTK main thread: queue them there
static gboolean squat_urgency(gpointer on) {
	GList *l = gtk_window_list_toplevels();
	for (GList *i = l; i != NULL; i = i->next) {
		GtkWindow *w = GTK_WINDOW(i->data);
		if (gtk_widget_get_visible(GTK_WIDGET(w)) && gtk_window_get_title(w) != NULL) {
			gtk_window_set_urgency_hint(w, GPOINTER_TO_INT(on) ? TRUE : FALSE);
			break;
		}
	}
	g_list_free(l);
	return G_SOURCE_REMOVE;
}
static void squatUrgency(int on) { g_idle_add(squat_urgency, GINT_TO_POINTER(on)); }
*/
import "C"

// requestAttention sets (or clears) the window's urgency hint: the panel flashes or highlights the window's entry (KDE, XFCE, most
// panels, i3bar and waybar workspaces); GNOME shows its "is ready" notice. The window manager clears it when the window is focused.
func requestAttention(on bool) {
	if on {
		C.squatUrgency(1)
	} else {
		C.squatUrgency(0)
	}
}
