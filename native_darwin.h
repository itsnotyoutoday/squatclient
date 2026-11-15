#ifndef SQUAT_NATIVE_DARWIN_H
#define SQUAT_NATIVE_DARWIN_H

// squatSetBadge puts n (0 = none) on the Dock icon.
void squatSetBadge(int n);
// squatHaveBundle reports whether the process runs from an app bundle (user notifications need one).
int squatHaveBundle(void);
// squatNotify posts a Notification Center banner; a click calls goNotifyClicked(session).
void squatNotify(const char *title, const char *body, const char *session);

#endif
