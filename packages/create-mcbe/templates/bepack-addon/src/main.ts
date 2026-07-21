import { world } from '@minecraft/server';

world.afterEvents.worldLoad.subscribe(() => {
  console.warn('Hello from create-mcbe + BEPack');
});
