'use strict';

const assert = require('power-assert');
const botkitMock = require('botkit-mock');
const nock = require('nock');
const rewire = require('rewire');

const events = require('../events');


describe('slack-kidoku', function() {
  this.timeout(0);
  beforeEach(() => {
    this.userInfo = {
      slackId : 'fakeuser',
      channel : 'C12345678'
    };
    this.controller = botkitMock({ /*debug : false*/ });
    this.bot = this.controller.spawn({ type : 'slack' });
    events(this.controller);
    });
  afterEach(()=>{
    //clean up botkit tick interval
    this.controller.shutdown();
  });
  it('test', (done) => {
    nock.recorder.rec();
    const interval = setInterval(() => { if(0) { done(); } }, 100);
  });
});
