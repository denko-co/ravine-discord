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
                thisGame.state = 'ingame';
                // console.log(thisGame);
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
                    craftSupplies: {
                      'WOOD': 3,
                      'STONE': 0,
                      'FIBER': 2
                    },
                    madness: [],
                    cardInFocus: null,
                    goingMad: false,
                    targeting: null,
                    targeted: false
                  };

                  // THIS IS FOR TESTING, PLEASE DELETE THIS FRANO
                  thisGame.players[message.author.id.toString()].gear.push(_.clone(cards.CRAFT)[1]);
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
            }
            break;
          case 'ingame':
            switch (command[0]) {
              case '!status':
                message.channel.send(printGame(thisGame));
                break;
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
                  thisGame.playersInFocus = _.keys(thisGame.players);
                  thisGame.isNight = true;
                  message.channel.send(tr.nightStart);
                  handleNight(thisGame, message);
                  // thisGame = handleNight(thisGame, message);
                } else {
                  // The hunt begins!
                  thisGame.playersInFocus = _.keys(thisGame.players);
                  thisGame = handleForage(thisGame, message);
                }
                break;
              case '!craft':
                if (thisGame.waiting) {
                  message.channel.send(tr.inProgress);
                } if (command[1]) {
                  var craftItemId = parseInt(command[1]);
                  if (craftItemId && thisGame.craft[craftItemId - 1]) {
                    var craftItem = thisGame.craft[craftItemId - 1];
                    var canCraft = checkAndSetCraft(player.craftSupplies, craftItem.recipe);
                    if (canCraft) {
                      if (craftItem.name === 'FIRE') {
                        if (thisGame.fire) {
                          message.channel.send(tr.doubleFire);
                          return;
                        } else if (!thisGame.canFire) {
                          message.channel.send(tr.cantFire);
                          return;
                        } else {
                          thisGame.fire = true;
                        }
                      } else {
                        player.gear.push(craftItem);
                      }
                      player.craftSupplies = canCraft;
                      message.channel.send(tr.cC);
                    } else {
                      message.channel.send(tr.noMaterial);
                    }
                  } else {
                    message.channel.send(tr.badCraft);
                  }
                } else {
                  message.channel.send(printCraftOptions(thisGame.craft));
                }
                break;
              case '!give':
                if (thisGame.waiting) {
                  message.channel.send(tr.inProgress);
                } else {
                  if (command[1] && command[2]) {
                    var personsCode = command[2].match(/^<@\d*>$/g);
                    var persons;
                    if (personsCode) {
                      persons = personsCode.toString().slice(2, -1);
                      if (thisGame.players[persons] && message.author.id.toString() !== persons) {
                        if (thisGame.players[persons].hearts <= 0) {
                          message.channel.send(tr.baddestGive);
                          return;
                        }
                      } else {
                        message.channel.send(tr.badderGive);
                        return;
                      }
                    } else {
                      message.channel.send(tr.badGive);
                      return;
                    }
                    var item = parseInt(command[1]);
                    if (item && player.gear[item - 1]) {
                      thisGame.players[persons].gear.push(player.gear[item - 1]);
                      player.gear.splice(item - 1, 1);
                      message.channel.send(tr.tC);
                    } else if (_.contains(['WOOD', 'STONE', 'FIBER'], command[1])) {
                      var numToGive = parseInt(command[3]);
                      if (numToGive || numToGive === 0) {
                        if (numToGive <= 0) {
                          message.channel.send(tr.numberGive);
                        } else if (numToGive > player.craftSupplies[command[1]]) {
                          message.channel.send(tr.baddingGive);
                        } else {
                          thisGame.players[persons].craftSupplies[command[1]] += numToGive;
                          player.craftSupplies[command[1]] -= numToGive;
                          message.channel.send(tr.tC);
                        }
                      } else {
                        message.channel.send(tr.badGive);
                      }
                    } else {
                      message.channel.send(tr.badGive);
                    }
                  } else {
                    message.channel.send(tr.badGive);
                  }
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
                        if (thisGame.isNight && !thisGame.players[thisGame.playersInFocus[0]].goingMad) {
                        // The night is upon us. Someone is trying to use something to counteract effects.
                          var currentEffect = thisGame.nightCardInFocus.blockedBy[thisGame.waitingForNight][0];
                          console.log(currentEffect);
                          console.log(itemDanger);
                          currentEffect = currentEffect === 'SACRIFICE FOOD' ? 'GAIN' : currentEffect;
                          if (itemDanger.hearts && currentEffect === 'GAIN') {
                            player.gear.splice(itemIdDanger - 1, 1);
                            thisGame = handleNight(thisGame, message, true);
                          } else {
                            for (var creativeIteratorNameIAmRunningOut = 0; creativeIteratorNameIAmRunningOut < itemDanger.effect.length; creativeIteratorNameIAmRunningOut++) {
                              if (itemDanger.effect[creativeIteratorNameIAmRunningOut].startsWith(currentEffect)) {
                                if (itemDanger.uses === 1) {
                                  player.gear.splice(itemIdDanger - 1, 1);
                                }
                                var choiceToProvide = (itemDanger.effect[creativeIteratorNameIAmRunningOut] === currentEffect && currentEffect !== 'GAIN') ? 'ALL' : true;
                                thisGame = handleNight(thisGame, message, choiceToProvide);
                                return;
                              }
                            }
                            message.channel.send(tr.nightUseWrong);
                          }
                        } else {
                          if (itemDanger.hearts) {
                            message.channel.send(tr.cantFood);
                          } else {
                            var isFood = false;
                            for (var i = 0; i < itemDanger.effect.length; i++) {
                              if (itemDanger.effect[i].startsWith('PROTECT')) {
                                player.gear.splice(itemIdDanger - 1, 1);
                                if (thisGame.players[thisGame.playersInFocus[0]].goingMad) {
                                  if (thisGame.isNight) {
                                    // Night madness, handle it!
                                  } else {
                                    // Foraging madness! Uh oh!
                                    thisGame = handleForage(thisGame, message, true);
                                  }
                                } else {
                                  thisGame = handleForage(thisGame, message, true);
                                }
                                return; // MFW NO BREAK >:(
                              } else if (itemDanger.effect[i].startsWith('GAIN')) {
                                isFood = true;
                              }
                            }
                            if (isFood) {
                              message.channel.send(tr.cantFood);
                            } else {
                              message.channel.send(tr.cantShelter);
                            }
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
                      var itemSafe = player.gear[itemIdSafe - 1];
                      var isFoodSafe = itemSafe.hearts;
                      var isProtectSafe = false;
                      if (!isFoodSafe) {
                        for (var j = 0; j < itemSafe.effect.length; j++) {
                          if (itemSafe.effect[j].startsWith('PROTECT')) {
                            isProtectSafe = true;
                          } else if (itemSafe.effect[j].startsWith('GAIN')) {
                            isFoodSafe = parseInt(itemSafe.effect[j].split(' ')[1]);
                          }
                        }
                      }
                      if (isFoodSafe) {
                        var peopleToFeed = command.length - 2;
                        if (peopleToFeed === 0) {
                          // Eat it all, yay!
                          if (player.maxHearts === player.hearts) {
                            message.channel.send(tr.dumbEat);
                          } else {
                            var valueToHeal = Math.min((player.maxHearts - player.hearts), isFoodSafe);
                            player.hearts += valueToHeal;
                            var msg2Send = tr.drawFood + ' <@' + message.author.id.toString() + '> ' + tr.h4 + valueToHeal + ' heart(s)';
                            if (player.maxHearts === player.hearts) {
                              msg2Send += tr.maxHP;
                            } else {
                              msg2Send += '.';
                            }
                            for (var singleMadness = player.madness.length - 1; singleMadness >= 0; singleMadness--) {
                              var singleMadnessCard = player.madness[singleMadness];
                              for (var singleMadnessRecov = 0; singleMadnessRecov < singleMadnessCard.recovery.length; singleMadnessRecov++) {
                                if (singleMadnessCard.recovery[singleMadnessRecov] === 'GAIN 1') {
                                  msg2Send += ' **' + singleMadnessCard.name + '** has been cured!';
                                  player.madness.splice(singleMadness, 1);
                                  break;
                                }
                              }
                            }
                            message.channel.send(msg2Send);
                            player.gear.splice(itemIdSafe - 1, 1);
                          }
                        } else if (peopleToFeed % 2 === 1) {
                          message.channel.send(tr.badEat);
                        } else {
                          var eatingPeople = [];
                          var foodCount = 0;
                          var hasMax = true;
                          for (var k = 2; k < command.length; k += 2) {
                            var personCode = command[k].match(/^<@\d*>$/g);
                            var person;
                            if (personCode) {
                              person = personCode.toString().slice(2, -1);
                            } else {
                              message.channel.send(tr.badEat);
                              return;
                            }
                            if (thisGame.players[person]) {
                              if (thisGame.players[person].hearts <= 0) {
                                message.channel.send(tr.baddestEat);
                                return;
                              }
                              var toEat = parseInt(command[k + 1]);
                              if (toEat) {
                                if (toEat > 0) {
                                  // All good!
                                  if (thisGame.players[person].hearts !== thisGame.players[person].maxHearts) {
                                    hasMax = false;
                                  }
                                  foodCount += toEat;
                                  eatingPeople.push({
                                    'person': person,
                                    'toEat': toEat
                                  });
                                } else {
                                  message.channel.send(tr.numberEat);
                                  return;
                                }
                              } else {
                                message.channel.send(tr.badEat);
                                return;
                              }
                            } else {
                              message.channel.send(tr.badderEat);
                              return;
                            }
                          }
                          if (hasMax) {
                            message.channel.send(tr.dumbEat);
                          } else if (foodCount !== isFoodSafe) {
                            if (foodCount > isFoodSafe) {
                              message.channel.send(tr.baddingEat);
                            } else {
                              message.channel.send(tr.paaf);
                            }
                          } else {
                            // Eat! Nom nom nom!
                            var msg2SendGroup = '';
                            for (var r = 0; r < eatingPeople.length; r++) {
                              var eating = thisGame.players[eatingPeople[r].person];
                              var valueToEat = Math.min((eating.maxHearts - eating.hearts), eatingPeople[r].toEat);
                              eating.hearts += valueToEat;
                              msg2SendGroup += '\n' + tr.drawFood + ' <@' + eatingPeople[r].person + '> ' + tr.h4 + valueToEat + ' heart(s)';
                              if (eating.maxHearts === eating.hearts) {
                                msg2SendGroup += tr.maxHP;
                              } else {
                                msg2SendGroup += '.';
                              }
                              for (var groupMadness = eating.madness.length - 1; groupMadness >= 0; groupMadness--) {
                                var groupMadnessCard = eating.madness[groupMadness];
                                for (var groupMadnessRecov = 0; groupMadnessRecov < groupMadnessCard.recovery.length; groupMadnessRecov++) {
                                  if (groupMadnessCard.recovery[groupMadnessRecov] === 'GAIN 1') {
                                    msg2SendGroup += ' **' + groupMadnessCard.name + '** has been cured!';
                                    eating.madness.splice(groupMadness, 1);
                                    break;
                                  }
                                }
                              }
                            }
                            message.channel.send(msg2SendGroup);
                            player.gear.splice(itemIdSafe - 1, 1);
                          }
                        }
                      } else if (isProtectSafe) {
                        message.channel.send(tr.cantProtect);
                      } else {
                        message.channel.send(tr.cantShelter);
                      }
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
                    if (thisGame.isNight) {
                      // Night madness, handle it!
                    } else {
                      // Foraging madness! Uh oh!
                      thisGame = handleForage(thisGame, message, false);
                    }
                    return;
                  }
                  if (thisGame.playersInFocus[0] === message.author.id.toString()) {
                    if (thisGame.isNight) {
                      thisGame = handleNight(thisGame, message, false);
                    } else {
                      thisGame = handleForage(thisGame, message, false);
                    }
                    break;
                  } else {
                    message.channel.send(tr.notYouPass);
                  }
                } else {
                  message.channel.send(tr.cantPass);
                }
                break;
              default:
                if (_.contains(_.pluck(player.madness, 'name'), 'SILENT TREATMENT')) { // Should do this off madness effects
                  message.channel.send(tr.silent);
                  player.hearts--;
                  return;
                }
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
                      if (!thisGame.players[def].goingMad && thisGame.players[def].hearts > 0) {
                        defenders.push(thisGame.players[def]);
                      }
                    }
                    if (canDefend(defenders, 'PROTECT')) {
                      // Send inspirational message
                      message.channel.send(message.content + tr.canDefendTeam1 + 'PROTECT' + tr.canDefendTeam1 + ' ' + tr.sadAttack);
                    } else {
                      // Nobody can stop this. Sorry.
                      if (thisGame.isNight) {
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
            message.channel.send(tr.isBug);
        }
      }
    } else if (message.content === tr.activate) {
      listeningTo[channelID] = {
        'players': {},
        'difficulty': ['Beginner: 7', 'Normal: 10', 'Difficult: 13'],
        'wreckage': _.shuffle(_.clone(cards.WRECKAGE)),
        'night': _.shuffle(_.clone(cards.NIGHT)),
        'madness': _.shuffle(_.clone(cards.MADNESS)),
        'craft': _.clone(cards.CRAFT),
        'state': 'joining',
        'fire': false,
        'canFire': true,
        'waiting': false,
        'haveForaged': false,
        'rounds': 0,
        'maxRounds': 0,
        'playersInFocus': [],
        'isNight': false,
        'nightCardInFocus': null,
        'waitingForNight': null,
        'needNight': null
      };
      var forage = _.clone(cards.FORAGE);
      var realForage = [];
      for (var f in _.keys(forage)) {
        var cardToDupe = forage[f];
        for (var z = 0; z < cardToDupe.count; z++) {
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

function printGame (thisGame) {
  var msg = 'It\'s ';
  msg += thisGame.isNight ? 'night' : 'day';
  msg += ' **' + (thisGame.maxRounds - thisGame.rounds + 1) + '/' + thisGame.maxRounds + '**.\nThe fire is currently ';
  msg += (thisGame.fire) ? '**lit**.\n' : '**out**.\n';
  msg += 'Foraging ';
  msg += (thisGame.haveForaged) ? 'is **done** for today.' : 'is **not done** yet.';
  return msg;
}

function checkAndSetCraft (mySupplies, recipeCost) {
  for (var supp in recipeCost) {
    var leftOver = mySupplies[supp] - recipeCost[supp];
    if (leftOver < 0) {
      return false;
    }
    mySupplies[supp] = leftOver;
  }
  return mySupplies;
}

function printCraftOptions (craftOptions) {
  var msg = '';
  for (var i = 0; i < craftOptions.length; i++) {
    msg += '\n**' + (i + 1) + '. ' + craftOptions[i].name + '** - *' + craftOptions[i].description + '* - ' + craftOptions[i].effectDescription + '\nRequires: ';
    for (var key in craftOptions[i].recipe) {
      msg += craftOptions[i].recipe[key] + ' ' + key + ' ';
    }
  }
  return msg;
}

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
  if (player.goingMad) {
    message += 'You\'re currently going mad (see above)';
  }
  if (player.madness.length === 0 && !player.goingMad) {
    message += 'You\'re sane! (at least, in game)';
  } else {
    for (var j = 0; j < player.madness.length; j++) {
      message += '\n' + printMadness(player.madness[j]);
    }
  }

  message += '\n\n__Craft: __\nWOOD: ' + player.craftSupplies.WOOD + '\nSTONE: ' + player.craftSupplies.STONE + '\nFIBER: ' + player.craftSupplies.FIBER;
  console.log(player);
  return message;
}

function blockedContains (blockList, block) {
  for (var i = 0; i < blockList.length; i++) {
    console.log(blockList[i][0]);
    if (blockList[i][0] === block) {
      return blockList[i][1];
    }
  }
  return null;
}

function handleNight (thisGame, message, choice) {
  var player = thisGame.players[thisGame.playersInFocus[0]];
  var nightCard;
  if (typeof choice !== 'undefined') {
    nightCard = thisGame.nightCardInFocus;
    if (choice) {
      if (choice === 'ALL') {
        message.channel.send('Item used, no night repercussions for all surviving players!');
        thisGame.nightCardInFocus = null;
        thisGame.playersInFocus = [];
        return thisGame;
      } else {
        message.channel.send('Item used, no night repercussions!');
        thisGame.waitingForNight = null;
        thisGame.playersInFocus.shift();
        player = thisGame.players[thisGame.playersInFocus[0]];
      }
    } else {
      message.channel.send('Passed, pls delete');
      thisGame.waitingForNight++;
    }
  } else {
    nightCard = thisGame.night.pop();
    thisGame.nightCardInFocus = nightCard;
    message.channel.send(printNight(nightCard));
    var fireBlock = blockedContains(nightCard.blockedBy, 'FIRE');
    if (thisGame.fire && fireBlock === 'CANCEL') {
      message.channel.send(tr.haveFire);
      thisGame.nightCardInFocus = null;
      thisGame.playersInFocus = [];
      return thisGame;
    }
    // Can probably move this segement down to effects
    if (fireBlock.startsWith('GAIN')) {
      var toGain = thisGame.fire ? 2 : 1;
      for (var gaining in thisGame.players) {
        if (thisGame.players[gaining].hearts > 0) {
          thisGame.players[gaining].hearts += toGain;
        }
      }
      message.channel.send(toGain + tr.gainHeartsAll);
      // This should probably be cleaned up huh?
      thisGame.nightCardInFocus = null;
      thisGame.playersInFocus = [];
      return thisGame;
    }
  }
  while (player) {
    if (!thisGame.waitingForNight) {
      thisGame.waitingForNight = 0;
      message.channel.send('<@' + thisGame.playersInFocus[0] + '>, you\'re up.');
    }
    var defenders = [];
    for (var def in thisGame.players) {
      if (thisGame.players[def].hearts > 0) {
        defenders.push(thisGame.players[def]);
      }
    }
    while (thisGame.waitingForNight < nightCard.blockedBy.length) {
      switch (nightCard.blockedBy[thisGame.waitingForNight][0]) {
        case 'SACRIFICE FOOD':
          if (canDefend(defenders, 'GAIN')) {
            message.channel.send('<@' + thisGame.playersInFocus[0] + '>' + tr.canDefendTeam1 + 'GAIN X HEART(S)' + tr.canDefendTeam2);
            thisGame.waiting = true;
            return thisGame;
          }
          break;
        case 'PROTECT':
        case 'SHELTER':
          if (canDefend(defenders, nightCard.blockedBy[thisGame.waitingForNight][0])) {
            message.channel.send('<@' + thisGame.playersInFocus[0] + '>' + tr.canDefendTeam1 + nightCard.blockedBy[thisGame.waitingForNight][0] + tr.canDefendTeam2);
            thisGame.waiting = true;
            return thisGame;
          }
          break;
        // If not in case, we don't care or it's an after modifier
      }
      thisGame.waitingForNight++;
    }
    // If you are down here, all hope is lost. Effects kick in.
    message.channel.send('<@' + thisGame.playersInFocus[0] + '> is affected!');
    thisGame.waitingForNight = null;
    thisGame.playersInFocus.shift();
    player = thisGame.players[thisGame.playersInFocus[0]];
  }
  thisGame.nightCardInFocus = null;
  thisGame.playersInFocus = [];
  message.channel.send('The night is over!');
  return thisGame;
}

function printNight (nightCard) {
  return '**"' + nightCard.name + '"** *(' + nightCard.description + ')*\n\n' + nightCard.effectDescription;
}

function handleForage (thisGame, message, choice) {
  var alter = 0;
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
  } else {
    if (player.forage !== 0) {
      // Handle 'alter'
      if (_.contains(_.pluck(player.madness, 'name'), 'BLIND RAGE')) { // Should do this off madness effects
        alter -= 1;
        message.channel.send(tr.blind);
      }
      if (_.contains(_.pluck(player.gear, 'name'), 'BASKET')) { // This too!
        alter += 1;
        message.channel.send(tr.basket);
      }
      player.currentForage += alter;
    }
  }
  while (player) {
    if (player.currentForage <= 0) {
      if (typeof choice === 'undefined') {
        if (alter === 0) {
          message.channel.send('<@' + thisGame.playersInFocus[0] + '> is taking a well deserved rest.');
        } else {
          message.channel.send('<@' + thisGame.playersInFocus[0] + '> finds nothing! Wow!');
        }
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
            player.craftSupplies[card.name] += 1;
          }
        }
        player.cardInFocus = null;
        player.currentForage--;
      }
    }
    thisGame.playersInFocus.shift();
    player = thisGame.players[thisGame.playersInFocus[0]];
    if (player && player.forage !== 0) {
      // Handle 'alter'
      if (_.contains(_.pluck(player.madness, 'name'), 'BLIND RAGE')) { // Should do this off madness effects
        alter -= 1;
        message.channel.send(tr.blind);
      }
      if (_.contains(_.pluck(player.gear, 'name'), 'BASKET')) { // This too!
        alter += 1;
        message.channel.send(tr.basket);
      }
      player.currentForage += alter;
    }
  }
  message.channel.send('The hunt is over!');
  thisGame.haveForaged = true;
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
  } else if (card.blockable && canDefend([player], 'PROTECT')) {
    message.channel.send('<@' + thisGame.playersInFocus[0] + '>' + tr.canDefendQuestion1 + 'PROTECT' + tr.canDefendQuestion2 + ' Repercussions: ' + card.effectDescription);
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

function canDefend (players, effect) {
  console.log(players);
  console.log(effect);
  for (var k = 0; k < players.length; k++) {
    var player = players[k];
    for (var i = 0; i < player.gear.length; i++) {
      if (player.gear[i].hearts && effect === 'GAIN') return true;
      if (player.gear[i].effect) {
        for (var j = 0; j < player.gear[i].effect.length; j++) {
          if (player.gear[i].effect[j].startsWith(effect)) return true;
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
    case 'MUST FEED':
      var card = thisGame.forage.pop();
      message.channel.send('You found ' + printForage(card));
      if (card.hearts) {
        player.gear.push(card);
        message.channel.send(tr.drawFood);
      } else {
        player.hearts -= 9001;
        message.channel.send('<@' + thisGame.playersInFocus[0] + '> ' + tr.loses9001);
      }
      break;
    case 'LOSE RANDOM':
      var flip = 0;
      for (var i = player.gear.length - 1; i >= 0; i--) {
        flip = _.random(1);
        if (flip) {
          player.gear.splice(i, 1);
        }
      }
      var supplies = _.keys(player.craftSupplies);
      for (var j = 0; j < supplies.length; j++) {
        var toKeep = 0;
        for (var keeps = 0; j < player.craftSupplies[supplies[j]]; keeps++) {
          toKeep += _.random(1);
        }
        player.craftSupplies[supplies[j]] = toKeep;
      }
      break;
    case 'STEAL 1':
    case 'DUEL LOSE 1':
      if (typeof choice !== 'undefined') {
        if (choice) {
          // Hit deflected! Ow!
          player.hearts--;
          message.channel.send('<@' + thisGame.playersInFocus[0] + '> ' + tr.getSmacked);
        } else {
          if (madness.effect[0] === 'STEAL 1') {
            if (player.hearts !== player.maxHearts) {
              player.hearts++;
              message.channel.send('<@' + thisGame.playersInFocus[0] + '> ' + tr.reverseSmacked);
            } else {
              message.channel.send('Sorry <@' + thisGame.playersInFocus[0] + '>, ' + tr.noHeal + '(' + player.maxHearts + ')');
            }
            thisGame.players[player.targeting].hearts--;
            message.channel.send('<@' + player.targeting + '> ' + tr.getSmacked);
          } else {
            // Other person hit, do the maths
            if (player.hearts >= thisGame.players[player.targeting].hearts) {
              thisGame.players[player.targeting].hearts--;
              message.channel.send('<@' + player.targeting + '> ' + tr.getSmacked);
            }
            if (player.hearts <= thisGame.players[player.targeting].hearts) {
              player.hearts--;
              message.channel.send('<@' + thisGame.playersInFocus[0] + '> ' + tr.getSmacked);
            }
          }
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
  var recovery = '\n';
  if (madness.recovery.length === 0) {
    recovery = '\n\nThere in no known cure.\n';
  } else if (madness.recovery[0] === 'NEXT') {
    recovery = '\n\nYou will automatically recover tomorrow.\n';
  } else if (madness.recovery[0] !== 'IMMEDIATE') {
    recovery = '\n\nGain 1 heart to cure.\n'; // LAZY!
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
