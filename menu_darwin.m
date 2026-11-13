#import <Cocoa/Cocoa.h>
#import "menu_darwin.h"

extern void goEditAction(int action);

@interface SquatEditTarget : NSObject
- (void)squatUndo:(id)sender;
- (void)squatRedo:(id)sender;
- (void)squatSettings:(id)sender;
- (void)squatAbout:(id)sender;
@end

@implementation SquatEditTarget
- (void)squatUndo:(id)sender { goEditAction(0); }
- (void)squatRedo:(id)sender { goEditAction(1); }
- (void)squatSettings:(id)sender { goEditAction(2); }
- (void)squatAbout:(id)sender { goEditAction(3); }
@end

static SquatEditTarget *squatTarget = nil;

void squatFixEditMenu(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (squatTarget == nil) squatTarget = [SquatEditTarget new];
        // "Settings..." (Cmd-,) belongs in the application menu on macOS, after About
        NSArray<NSMenuItem *> *tops = [[NSApp mainMenu] itemArray];
        NSMenu *appMenu = tops.count > 0 ? [tops[0] submenu] : nil;
        // the native About panel is replaced by the page's own About dialog (same on every platform)
        for (NSMenuItem *it in (appMenu != nil ? [appMenu itemArray] : @[])) {
            if ([it action] == NSSelectorFromString(@"About")) {
                [it setTarget:squatTarget];
                [it setAction:@selector(squatAbout:)];
            }
        }
        if (appMenu != nil && [appMenu indexOfItemWithTarget:squatTarget andAction:@selector(squatSettings:)] < 0) {
            NSMenuItem *st = [[NSMenuItem alloc] initWithTitle:@"Settings\u2026" action:@selector(squatSettings:) keyEquivalent:@","];
            [st setKeyEquivalentModifierMask:NSEventModifierFlagCommand];
            [st setTarget:squatTarget];
            NSInteger at = MIN(2, (NSInteger)[appMenu numberOfItems]);
            [appMenu insertItem:st atIndex:at];
            [appMenu insertItem:[NSMenuItem separatorItem] atIndex:at + 1];
        }
        for (NSMenuItem *top in tops) {
            NSMenu *sub = [top submenu];
            if (sub == nil || ![[sub title] isEqualToString:@"Edit"]) continue;
            for (NSMenuItem *it in [sub itemArray]) {
                SEL a = [it action];
                if (a == @selector(undo:) || a == @selector(redo:)) {
                    BOOL undo = (a == @selector(undo:));
                    [it setKeyEquivalent:@""];
                    [it setKeyEquivalentModifierMask:0];
                    [it setTarget:squatTarget];
                    [it setAction:undo ? @selector(squatUndo:) : @selector(squatRedo:)];
                }
            }
        }
    });
}
