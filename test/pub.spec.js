const EventEmitter = require('events').EventEmitter;

const PubSub = require('../index.js');

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));

const pubsub = new PubSub('pubsub', emitter, {
  projectId: 'quizizz-dev',
});

function push() {
  return pubsub.init()
    .then(() => pubsub.createTopic('test'))
    .then(() => pubsub.publish('test', { message: 'one' }))
    .then(() => pubsub.publish('test', { message: 'two' }))
    .then(() => pubsub.publish('test', { message: 'three' }))
    .then(() => pubsub.publish('test', { message: 'four' }))
    .then(() => pubsub.publish('test', { message: 'five' }))
    .then(() => pubsub.publish('test', { message: 'six' }))
    .then(() => pubsub.publish('test', { message: 'seven' }));
}

push().then(() => console.log('Pusblish')).catch(console.error.bind(console));

