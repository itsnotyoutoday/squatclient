import type { ComponentType } from 'react';
import {
  App,
  Box,
  Button,
  Chat,
  Column,
  Dock,
  InputBar,
  List,
  Mush,
  Panel,
  RoomInfo,
  Row,
  Text,
  Vitals,
  When,
  Gauge,
} from './components';

/**
 * Layouts that ship with the app. They are written in the same language users write theirs in; they are
 * compiled with the app (no run-time compile, no consent prompt).
 */

/** The app as it always was: the output, then the input line. */
export function Classic() {
  return (
    <App>
      <Mush />
      <InputBar />
    </App>
  );
}

/** Works with any game that reports vitals, room and inventory, whatever it calls them. */
export function SidebarRight() {
  return (
    <App>
      <Row>
        <Mush />
        <Dock side="right" width={230}>
          <Vitals />
          <RoomInfo />
          <List title="Inventory" value="items:inv" send="look {name}" />
          <Chat height={160} />
        </Dock>
      </Row>
      <InputBar />
    </App>
  );
}

/** The vitals as a bar along the bottom, above the input line. */
export function VitalsBottom() {
  return (
    <App>
      <Mush />
      <Dock side="bottom">
        <Row gap={12}>
          <Vitals />
        </Row>
      </Dock>
      <InputBar />
    </App>
  );
}

/** A layout for the local Evennia test game (see scripts/gmcpdump and the testgames notes in docs/LAYOUTS.md). */
export function EvenniaDemo() {
  return (
    <App>
      <Row>
        <Mush />
        <Dock side="right" width={250}>
          <When gmcp="Char.Status">
            <Panel title="Character">
              <Text label="Name" value="gmcp:Char.Status.name" />
              <Text label="Class" value="gmcp:Char.Status.class" />
              <Text label="Level" value="gmcp:Char.Status.level" />
              <Text label="Gold" value="gmcp:Char.Status.gold" />
            </Panel>
          </When>
          <Panel title="Vitals">
            <Vitals />
            <Gauge
              label="XP"
              value="gmcp:Char.Status.xp"
              max="gmcp:Char.Status.nextxp"
              color="accent"
              format="{percent}"
            />
          </Panel>
          <Panel title="Room">
            <RoomInfo />
          </Panel>
          <List title="Inventory" value="items:inv" send="look {name}" empty="Nothing carried." />
          <Chat height={150} />
        </Dock>
      </Row>
      <Dock side="bottom">
        <Column>
          <Row gap={6}>
            <Button send="look">Look</Button>
            <Button send="hurt 10">Hurt</Button>
            <Button send="heal">Heal</Button>
            <Button send="run">Run</Button>
            <Box grow={1} />
          </Row>
        </Column>
      </Dock>
      <InputBar />
    </App>
  );
}

export interface BuiltinLayout {
  id: string;
  name: string;
  description: string;
  component: ComponentType;
}

export const BUILTIN_LAYOUTS: BuiltinLayout[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'The output and the input line, as before.',
    component: Classic,
  },
  {
    id: 'sidebar',
    name: 'Sidebar',
    description: 'Vitals, room, inventory and chat in a right-hand panel when the game reports them.',
    component: SidebarRight,
  },
  {
    id: 'vitals-bottom',
    name: 'Vitals bar',
    description: 'Vitals along the bottom when the game reports them.',
    component: VitalsBottom,
  },
  {
    id: 'evennia-demo',
    name: 'Evennia demo',
    description:
      'Character, vitals, room, inventory, chat and quick buttons for the local Evennia test game.',
    component: EvenniaDemo,
  },
];

export const findBuiltin = (id: string | undefined): BuiltinLayout | undefined =>
  BUILTIN_LAYOUTS.find((l) => l.id === id);
