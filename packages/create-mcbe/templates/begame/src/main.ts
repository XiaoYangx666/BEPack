import { world } from '@minecraft/server';

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;

  player.sendMessage('Welcome to your new BEGame world!');
});
