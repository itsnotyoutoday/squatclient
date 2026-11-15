#import <Cocoa/Cocoa.h>
#import <UserNotifications/UserNotifications.h>
#include "native_darwin.h"

extern void goNotifyClicked(char *session);

void squatSetBadge(int n) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[NSApp dockTile] setBadgeLabel:(n > 0 ? [NSString stringWithFormat:@"%d", n] : nil)];
    });
}

int squatHaveBundle(void) { return [[NSBundle mainBundle] bundleIdentifier] != nil; }

@interface SquatNotifyDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation SquatNotifyDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done {
    done(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))done {
    NSString *sid = response.notification.request.content.userInfo[@"session"];
    [NSApp activateIgnoringOtherApps:YES];
    goNotifyClicked((char *)[(sid ? sid : @"") UTF8String]);
    done();
}
@end

static SquatNotifyDelegate *squatDelegate;

void squatNotify(const char *title, const char *body, const char *session) {
    NSString *t = [NSString stringWithUTF8String:title], *b = [NSString stringWithUTF8String:body], *s = [NSString stringWithUTF8String:session];
    dispatch_async(dispatch_get_main_queue(), ^{
        UNUserNotificationCenter *c = [UNUserNotificationCenter currentNotificationCenter];
        if (squatDelegate == nil) {
            squatDelegate = [SquatNotifyDelegate new];
            c.delegate = squatDelegate;
        }
        [c requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                         completionHandler:^(BOOL granted, NSError *err) {
            if (!granted) return;
            UNMutableNotificationContent *m = [UNMutableNotificationContent new];
            m.title = t;
            m.body = b;
            m.userInfo = @{@"session": s};
            UNNotificationRequest *r = [UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString] content:m trigger:nil];
            [c addNotificationRequest:r withCompletionHandler:nil];
        }];
    });
}
