#import <Cocoa/Cocoa.h>
#import "menu_darwin.h"

extern void goEditAction(int action);

@interface SquatEditTarget : NSObject
- (void)squatUndo:(id)sender;
- (void)squatRedo:(id)sender;
@end

@implementation SquatEditTarget
- (void)squatUndo:(id)sender { goEditAction(0); }
- (void)squatRedo:(id)sender { goEditAction(1); }
@end

static SquatEditTarget *squatTarget = nil;

void squatFixEditMenu(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (squatTarget == nil) squatTarget = [SquatEditTarget new];
        for (NSMenuItem *top in [[NSApp mainMenu] itemArray]) {
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
