const fs = require('fs');

function replaceFile(path, replaces) {
  let content = fs.readFileSync(path, 'utf8');
  for (const [from, to] of replaces) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(path, content);
}

// Fix members.service.ts
replaceFile('src/modules/members/members.service.ts', [
  ['ctx.userId: ctx.userId', 'actorId: ctx.userId'],
  ['actorId: ctx.userId,', 'actorId: ctx.userId,'], // no-op just in case
]);
