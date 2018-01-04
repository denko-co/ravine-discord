var express = require('express');
var _ = require('underscore');
var app = express();
var tr = require('./translations.json');
var cards = require('./cards.json');
var Discord = require('discord.js');
var bot = new Discord.Client({autoReconnect: true});
var listeningTo = {};

bot.login(process.env.TOKEN);

bot.on('ready', function (event) {
  console.log('Logged in as %s - %s\n', bot.user.username, bot.user.id);
});

bot.on('message', function (message) {
  if (!message.author.bot && message.content) {
    console.log(message.author.username + ' - ' + message.author.id + ' - ' + message.channel.id + ' - ' + message.content);
    var channelID = message.channel.id.toString();
    if (channelID in listeningTo) {
      var command = message.content.match(/\S+/g) || [];
      var thisGame = listeningTo[channelID];
      var player = thisGame.players[message.author.id.toString()];
      // console.log(player); // DELET THIS
      if (message.content === '!help') {
        // Send the player some instructions, regardless of current game state
      } else {
        if (!player && thisGame.state !== 'joining') {
          return; // If we're in game, ignore messages that aren't players
        }
        switch (thisGame.state) {
          case 'joining':
            if (thisGame.waiting && player) {
              var num = parseInt(message.content);
              if (num && num > 0 && num < thisGame.difficulty.length) {
                var rounds = parseInt(thisGame.difficulty[num - 1].split(' ')[1]);
                thisGame.rounds = rounds;
                thisGame.maxRounds = rounds;
                thisGame.waiting = false;
                // Give players their starting health and a starting item
                for (var p in thisGame.players) {
                  var playerToGive = thisGame.players[p];
                  playerToGive.hearts += _.random(playerToGive.maxHearts - playerToGive.hearts);
                  playerToGive.gear.push(thisGame.wreckage.pop());
                }
                thisGame.state = 'day';

                message.channel.send(tr.realStart).then(function (message) {
                  message.channel.send(printDayStart(thisGame) + tr.needHelp);
                });
              }
              break;
            }
            switch (command[0]) {
              case '!join':
                if (player) {
                  message.channel.send(tr.alreadyJoined);
                } else if (_.size(thisGame.players) === 3) {
                  message.channel.send(tr.sorryFull);
                } else {
                  thisGame.players[message.author.id.toString()] = {
                    gear: [],
                    hearts: 3,
                    maxHearts: 6,
                    forage: 0,
                    currentForage: 0,
                    craft: [],
                    madness: [],
                    cardInFocus: null,
                    goingMad: false,
                    targeting: null,
                    targeted: false
                  };

                  // THIS IS FOR TESTING, PLEASE DELETE THIS FRANO
                  thisGame.players[message.author.id.toString()].gear.push(_.clone(cards.CRAFT)[1]);
                  console.log(thisGame.players[message.author.id.toString()]);
                  message.channel.send(tr.welcome);
                }
                break;
              case '!leave':
                if (!player) {
                  message.channel.send(tr.uhhhh);
                } else {
                  delete thisGame.players[message.author.id.toString()];
                  message.channel.send(tr.bye);
                }
                break;
              case '!start':
                if (_.size(thisGame.players) === 0) {
                  message.channel.send(tr.sorryEmpty);
                } else if (!player) {
                  message.channel.send(tr.falseStart);
                } else {
                  thisGame.waiting = true;
                  message.channel.send(tr.start1).then(function (message) {
                    message.channel.send(tr.start2 + '\n' + printOptions(thisGame.difficulty));
                  });
                }
                break;
              default:
                message.channel.send('Nothing to do! Don\'t forget to delete this!');
            }
            break;
          case 'day':
            switch (command[0]) {
              case '!me':
                message.channel.send(printPlayer(player, message.author.id.toString()));
                break;
              case '!forage':
                if (thisGame.waiting) {
                  message.channel.send(tr.inProgress);
                } else if (thisGame.haveForaged) {
                  message.channel.send(tr.cantForage);
                } else if (command[1]) {
                  var numHearts = parseInt(command[1]);
                  if ((numHearts === 0 || numHearts) && numHearts >= 0 && numHearts <= 3) {
                    player.forage = numHearts;
                    player.currentForage = numHearts;
                    message.channel.send('Foraging for ' + numHearts + ', type `!ready` to begin the hunt!');
                  } else {
                    message.channel.send(tr.mustForage);
                  }
                } else {
                  message.channel.send(tr.mustForage);
                }
                break;
              case '!ready':
                if (thisGame.waiting) {
                  message.channel.send(tr.inProgress);
                } else if (thisGame.haveForaged) {
                  // Night is starting
                } else {
                  // The hunt begins!
                  thisGame.playersInFocus = _.keys(thisGame.players);
                  thisGame = handleForage(thisGame, message);
                }
                break;
              case '!craft':
                if (thisGame.waiting) {
                  message.channel.send(tr.inProgress);
                }
                break;
              case '!give':
                if (thisGame.waiting) {
                  message.channel.send(tr.inProgress);
                }
                break;
              case '!use':
                if (thisGame.waiting) {
                  if (thisGame.playersInFocus[0] === message.author.id.toString() || thisGame.players[thisGame.playersInFocus[0]].goingMad) {
                    if (player.goingMad) {
                      message.channel.send(tr.uMad);
                      return;
                    }
                    if (command[1]) {
                      var itemIdDanger = parseInt(command[1]);
                      if (itemIdDanger && player.gear[itemIdDanger - 1]) {
                        var itemDanger = player.gear[itemIdDanger - 1];
                        if (itemDanger.hearts) {
                          message.channel.send(tr.cantFood);
                        } else {
                          var isFood = false;
                          for (var i = 0; i < itemDanger.effect.length; i++) {
                            if (itemDanger.effect[i].startsWith('PROTECT')) {
                              player.gear = player.gear.splice(itemIdDanger - 2, 1);
                              if (thisGame.players[thisGame.playersInFocus[0]].goingMad) {
                                if (thisGame.haveForaged) {
                                  // Night madness, handle it!
                                } else {
                                  // Foraging madness! Uh oh!
                                  thisGame = handleForage(thisGame, message, true);
                                }
                              } else {
                                thisGame = handleForage(thisGame, message, true);
                              }
                              return; // MFW NO BREAK >:(
                            } else if (itemDanger.effect[i].startsWith('PROTECT')) {
                              isFood = true;
                            }
                          }
                          if (isFood) {
                            message.channel.send(tr.cantFood);
                          } else {
                            message.channel.send(tr.cantShelter);
                          }
                        }
                      } else {
                        message.channel.send(tr.mustUse);
                      }
                    } else {
                      message.channel.send(tr.mustUse);
                    }
                  } else {
                    message.channel.send(tr.notYouUse);
                  }
                } else {
                  if (command[1]) {
                    var itemIdSafe = parseInt(command[1]);
                    if (itemIdSafe && player.gear[itemIdSafe - 1]) {
                      console.log('Need to implement this!');
                    } else {
                      message.channel.send(tr.mustUse);
                    }
                  } else {
                    message.channel.send(tr.mustUse);
                  }
                }
                break;
              case '!pass':
                if (thisGame.waiting) {
                  if (player.goingMad) {
                    message.channel.send(tr.notYouPass);
                    return;
                  } if (player.targeted) {
                    if (thisGame.haveForaged) {
                      // Night madness, handle it!
                    } else {
                      // Foraging madness! Uh oh!
                      thisGame = handleForage(thisGame, message, false);
                    }
                    return;
                  }
                  if (thisGame.playersInFocus[0] === message.author.id.toString()) {
                    thisGame = handleForage(thisGame, message, false);
                    break;
                  } else {
                    message.channel.send(tr.notYouPass);
                  }
                } else {
                  message.channel.send(tr.cantPass);
                }
                break;
              default:
                if (player.goingMad && !(player.targeting)) {
                  // Mad person typed something
                  var res = message.content.match(/^<@\d*>$/g);
                  if (res) {
                    var target = res.toString().slice(2, -1);
                    if (!thisGame.players[target]) {
                      message.channel.send(tr.really);
                    }
                    player.targeting = target;
                    thisGame.players[target].targeted = true;
                    var defenders = [];
                    for (var def in thisGame.players) {
                      if (!thisGame.players[def].goingMad) {
                        defenders.push(thisGame.players[def]);
                      }
                    }
                    if (canProtect(defenders)) {
                      // Send inspirational message
                      message.channel.send(message.content + tr.canProtectTeam + '. ' + tr.sadAttack);
                    } else {
                      // Nobody can stop this. Sorry.
                      if (this.haveForaged) {
                        // Night madness, handle it!
                      } else {
                        // Foraging madness! Uh oh!
                        thisGame = handleForage(thisGame, message, false);
                      }
                    }
                  }
                }
            }
            break;
          default:
            message.channel.send('You should never see this. Don\'t forget to delete this!');
        }
      }
    } else if (message.content === tr.activate) {
      listeningTo[channelID] = {
        'players': {},
        'difficulty': ['Beginner: 7', 'Normal: 10', 'Difficult: 13'],
        'wreckage': _.shuffle(_.clone(cards.WRECKAGE)),
        'night': _.shuffle(_.clone(cards.NIGHT)),
        'madness': _.shuffle(_.clone(cards.MADNESS)),
        'craft': _.shuffle(_.clone(cards.CRAFT)), // NEED TO REAL COUNT THIS
        'state': 'joining',
        'fire': false,
        'waiting': false,
        'haveForaged': false,
        'rounds': 0,
        'maxRounds': 0,
        'playersInFocus': []
      };
      var forage = _.clone(cards.FORAGE);
      var realForage = [];
      for (var f in _.keys(forage)) {
        var cardToDupe = forage[f];
        for (var j = 0; j < cardToDupe.count; j++) {
          var dupeCard = _.clone(cardToDupe);
          delete dupeCard['count'];
          realForage.push(dupeCard);
        }
      }
      listeningTo[channelID]['forage'] = _.shuffle(realForage);
      message.channel.send(tr.introduce);
    }
  }
});

function printPlayer (player, usernaem) {
  var message = '<@' + usernaem + '>:\n';
  if (player.hearts <= 0) {
    return tr.ded;
  }
  message += '__Gear: __ ';

  if (player.gear.length === 0) {
    message += ' No gear!';
  } else {
    for (var i = 0; i < player.gear.length; i++) {
      if (player.gear[i].hearts) {
        message += '\n**' + (i + 1) + '.** *' + player.gear[i].name + ' - Restore ' + player.gear[i].hearts + ' heart(s)*';
      } else {
        message += '\n**' + (i + 1) + '.** *' + player.gear[i].name + ' - ' + player.gear[i].effectDescription + '*';
      }
    }
  }

  message += '\n\n__Hearts: __' + player.hearts + '\n\n__Madness: __';
  if (player.madness.length === 0) {
    message += 'You\'re sane! (at least, in game)';
  } else {
    for (var j = 0; j < player.madness.length; j++) {
      message += printMadness(player.madness[j]);
    }
  }

  var craftStuff = {
    'WOOD': 0,
    'STONE': 0,
    'FIBER': 0
  };
  for (var k = 0; k < player.craft.length; k++) {
    craftStuff[player.craft.name] += 1;
  }
  message += '\n\n__Craft: __\nWOOD: ' + craftStuff.WOOD + '\nSTONE: ' + craftStuff.STONE + '\nFIBER: ' + craftStuff.FIBER;

  return message;
}

function handleForage (thisGame, message, choice) {
  var player = thisGame.players[thisGame.playersInFocus[0]];
  if (typeof choice !== 'undefined') {
    if (player.targeting) {
      var result = handleMadness(player, thisGame, message, choice);
      player = result[0];
      thisGame = result[2];
    } else {
      player = handleForageEffect(player.cardInFocus, player, message, thisGame, choice)[0];
    }
    player.cardInFocus = null;
    thisGame.waiting = false;
    player.currentForage--;
  }
  while (player) {
    if (player.currentForage === 0) {
      if (typeof choice === 'undefined') {
        message.channel.send('<@' + thisGame.playersInFocus[0] + '> is taking a well deserved rest.');
      }
    } else {
      message.channel.send('<@' + thisGame.playersInFocus[0] + '> is foraging!');
      while (player.currentForage > 0) {
        var card = thisGame.forage.pop();
        player.cardInFocus = card;
        message.channel.send('You found ' + printForage(card));
        if (card.effect) {
          var results = handleForageEffect(card, player, message, thisGame);
          player = results[0];
          if (results[1]) {
            thisGame.waiting = true;
            return thisGame;
          }
        } else {
          if (card.hearts) {
            player.gear.push(card);
          } else {
            player.craft.push(card);
          }
        }
        player.cardInFocus = null;
        player.currentForage--;
      }
    }
    thisGame.playersInFocus.shift();
    player = thisGame.players[thisGame.playersInFocus[0]];
  }
  message.channel.send('The hunt is over!');
  return thisGame;
}

function printForage (card) {
  var cardText = card.description + ' **' + card.name + '**';
  if (card.hearts) {
    cardText += ' *(restores ' + card.hearts + ' heart(s))*';
  }
  return cardText;
}

function handleForageEffect (card, player, message, thisGame, choice) {
  if (typeof choice !== 'undefined') {
    if (choice) {
      message.channel.send('Item used, no forage repercussions!');
      return [player, false];
    }
  } else if (card.blockable && canProtect([player])) {
    message.channel.send('<@' + thisGame.playersInFocus[0] + '>' + tr.canProtectQuestion + ' Repercussions: ' + card.effectDescription);
    return [player, true];
  }
  message.channel.send(card.effectDescription);
  for (var i = 0; i < card.effect.length; i++) {
    var effectDetails = card.effect[i].split(' ');
    switch (effectDetails[0]) {
      case 'MADNESS':
        return handleMadness(player, thisGame, message, choice);
      case 'PARALYSIS':
        player.madness.push(card);
        break;
      case 'LOSE':
        player.hearts -= parseInt(effectDetails[1]);
        break;
    }
  }
  return [player, false];
}

function canProtect (players) {
  for (var k = 0; k < players.length; k++) {
    var player = players[k];
    for (var i = 0; i < player.gear.length; i++) {
      if (player.gear[i].effect) {
        for (var j = 0; j < player.gear[i].effect.length; j++) {
          if (player.gear[i].effect[j].startsWith('PROTECT')) return true;
        }
      }
    }
  }
  return false;
}

function handleMadness (player, thisGame, message, choice) {
  // Who know what's in store?
  var madness;
  if (player.goingMad) {
    madness = player.cardInFocus;
  } else {
    player.goingMad = true;
    madness = thisGame.madness.pop();
    player.cardInFocus = madness;
    message.channel.send(printMadness(madness));
  }
  switch (madness.effect[0]) {
    case 'DUEL LOSE 1':
      if (typeof choice !== 'undefined') {
        if (choice) {
          // Hit deflected! Ow!
          player.hearts--;
        } else {
          // Other person hit
          thisGame.players[player.targeting].hearts--;
        }
        thisGame.players[player.targeting].targeted = false;
        player.targeting = null;
      } else {
        return [player, true, thisGame];
      }
      break;
    default:
      player.madness.push(madness);
  }
  player.goingMad = false;
  return [player, false, thisGame];
}

function printMadness (madness) {
  var recovery = '';
  if (madness.recovery === []) {
    recovery = '\n\nThere in no known cure.';
  } else if (recovery[0] === 'NEXT') {
    recovery = '\n\nYou will automatically recover tomorrow.';
  } else if (recovery[0] !== 'IMMEDIATE') {
    recovery = '\n\nGain 1 heart to cure.'; // LAZY!
  }
  return '/*\nYou\'ve been afflicted by **"' + madness.name + '"** *(' + madness.description + ')*\n\n' + madness.effectDescription + recovery + '*/';
}

function printDayStart (thisGame) {
  return tr.dayStart + ' It\'s day ' + (thisGame.maxRounds - thisGame.rounds + 1) + '. ';
}

function printOptions (array) {
  var options = '';
  for (var i = 0; i < array.length; i++) {
    options += '**' + (i + 1) + '.** *' + array[i] + '*\n';
  }
  return options;
}

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));

app.get('/', function (request, response) {
  response.send('Hello World!');
});

app.listen(app.get('port'), function () {
  console.log('Node app is running at localhost:' + app.get('port'));
});
