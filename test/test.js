'use strict';

const assert = require('power-assert');
const botkitMock = require('botkit-mock');
const nock = require('nock');
const rewire = require('rewire');

const events = require('../events.js');

nock.recorder.rec();

describe('slack-kidoku', function() {
  this.timeout(10000);
  const self = this;
  before(function() {
    this.userInfo = {
      slackId : 'fakeuser',
      channel : 'C12345678'
    };
    this.controller = botkitMock({ /*debug : false*/ });
    this.bot = this.controller.spawn({ type : 'slack' });
    events(this.controller);
  });
  afterEach(function() {
    this.controller.shutdown();
  });
  describe('/kidoku command', function() {
    before(function() {
      this.sequence = [{
          type : 'slash_command',
          user : this.userInfo.slackId,
          channel : this.userInfo.channel,
          messages : [
          {
            isAssertion : true
            }
          ]
      }];
    });
    it('should return confirm message', function() {
      return this.bot.usersInput(this.sequence).then((message) => {
        console.log(message);
        return assert.equal(1,1);
      })
    });
  });
});
