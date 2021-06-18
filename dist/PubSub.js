"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pubsub_1 = require("@google-cloud/pubsub");
const safely_parse_json_1 = __importDefault(require("safely-parse-json"));
/**
 * @class PubSub
 */
class PubSub {
    /**
     * @param {string} name - unique name to this service
     * @param {EventEmitter} emitter
     * @param {Object} config - configuration object of service
     */
    name;
    emitter;
    config;
    client;
    topics;
    constructor(name, emitter, config) {
        this.name = name;
        this.emitter = emitter;
        this.config = { ack_deadline_seconds: 300, ...config };
        this.client = null;
        this.topics = {};
    }
    log(message, data) {
        this.emitter.emit('log', {
            service: this.name,
            message,
            data,
        });
    }
    success(message, data) {
        this.emitter.emit('success', {
            service: this.name,
            message,
            data,
        });
    }
    error(err, data) {
        this.emitter.emit('error', {
            service: this.name,
            data,
            err,
        });
    }
    /**
     * Initialize the config for connecting to google apis
     *
     * @return {Promise<this>}
     */
    async init() {
        this.log('Using config', {
            projectId: this.config.projectId,
            email: this.config.credentials
                ? this.config.credentials.client_email
                : 'n/a',
            method: this.config.credentials ? 'PrivateKey' : 'KeyFile',
        });
        const client = new pubsub_1.PubSub({
            projectId: this.config.projectId,
            keyFile: this.config.file,
            credentials: this.config.credentials,
        });
        return client.getTopics().then(() => {
            this.client = client;
            this.success(`Successfully connected on project ${this.config.projectId}`);
            return this;
        });
    }
    /**
     * Create a topic, must be done before anything else
     *
     * @param string name - name of the topic ot use
     *
     * @return {Promise<boolean>}
     */
    async createTopic(name) {
        const topic = this.client.topic(name);
        this.log(`Creating topic ${name}`);
        const [exists] = await topic.exists();
        if (exists === true) {
            this.success(`Topic "${name}" already exists`);
            this.topics[name] = topic;
            return true;
        }
        // Create the topic
        const [createdTopic] = await topic.create();
        this.topics[name] = createdTopic;
        const message = `Topic "${name}" created`;
        this.success(message);
        return true;
    }
    /**
     * Delete a topic, won't delete the subscription though
     *
     * @param {string} name - topic to delete
     *
     * @return {Promise<boolean>} resolve(true)
     */
    async deleteTopic(name) {
        const topic = this.topics[name];
        await topic.delete();
        const message = `Deleted topic ${topic.name}`;
        this.log(message);
        delete this.topics[name];
        return true;
    }
    /**
     * Create a subscription and assign callback on message
     *
     * @param {string} topicName
     * @param {string} subName
     * @param {Function} cb - will get <message> with the following props
     *  id, ackId, data <pusblished>, attributes, timestamp, ack(), skip()
     * @param {Object} options - tuning params
     * @param {number} options.ackDeadlineSeconds - number of seconds
     *   after which message will marked nack
     * @param {boolean} [options.autoAck=false]
     * @param {string} [options.encoding='utf-8']
     * @param {number} [options.interval=1] - interval between taking next message
     * @param {number} [options.maxInProgress=1] - number of message at once
     * @param {string} [options.pushEndPoint]
     * @param {number} [options.timeout] - http call
     *
     * @return {Promise<true>}
     */
    async subscribe(topicName, subName, cb, options = {}) {
        const { maxInProgress = 1, ackDeadlineSeconds = this.config.ack_deadline_seconds } = options;
        const opts = {
            flowControl: {
                maxMessages: maxInProgress,
            },
            ackDeadline: ackDeadlineSeconds,
        };
        const topic = this.topics[topicName];
        let subscription = topic.subscription(subName, opts);
        this.log('Subscribing', {
            topicName,
            subName,
            opts: { maxInProgress, ackDeadlineSeconds },
        });
        // Check if the subscription exists
        return subscription
            .exists()
            .then((result) => {
            const exists = result[0];
            if (exists === true) {
                this.success('Subscription already exists', {
                    topicName: topic.name,
                    subName: subscription.name,
                });
                return subscription;
            }
            return subscription.create().then((res) => {
                this.success('Created subscription', {
                    topicName: topic.name,
                    subName: subscription.name,
                });
                subscription = res[0]; // eslint-disable-line
                return subscription;
            });
        })
            .then((sub) => {
            sub.on('message', (msg) => {
                const newmsg = {
                    nack: msg.nack ? msg.nack.bind(msg) : () => { },
                    skip: msg.skip ? msg.skip.bind(msg) : () => { },
                    ack: msg.ack.bind(msg),
                    data: safely_parse_json_1.default(msg.data.toString()),
                };
                return cb(newmsg);
            });
            sub.on('error', (err) => {
                this.error(err, {
                    topicName: topic.name,
                    subName: sub.name,
                });
            });
            return true;
        });
    }
    /**
     * Remove a subscription from a topic
     *
     * @param {string} topicName
     * @param {string} subName
     * @param {Function} cb
     *
     * @return {Promise<true>}
     */
    async unsubscribe(topicName, subName, cb) {
        const topic = this.topics[topicName];
        const subscription = topic.subscription(subName);
        // Remove the listener from subscription
        subscription.removeListener('message', cb);
        return subscription.delete().then(() => {
            const message = `Removed listener from ${topic.name}, ${subscription.name}`;
            this.log(message, {
                topicName: topic.name,
                subName: subscription.name,
            });
            return true;
        });
    }
    /**
     * Publish a message on the given queue
     *
     * @param {string} topicName - topic should be created in this instance
     * @param {Object} content - the data to send in negotiated structure
     * @param {Object} meta - things like correlationId and replyTo
     * @param {string} meta.replyTo
     * @param {string} meta.correlationId
     * @param {boolean} [handle=true] - whether to handle the error here
     *
     * @return {Promise}
     */
    async publish(topicName, content, meta = {}, handle = true) {
        const topic = this.topics[topicName];
        const publishPromise = topic.publisher.publish(Buffer.from(JSON.stringify({
            content,
            meta,
        })));
        if (handle === false) {
            return;
        }
        await publishPromise.catch((err) => {
            this.error(err, {
                topicName,
                message: content,
                options: meta,
            });
        });
    }
    /**
     * Just send on the topic, don't worry whether it exists or not
     *
     * @param {string} topicName - name of topic
     * @param {Object} content - the data to send in negotiated structure
     * @param {Object} meta - things like correlationId and replyTo
     * @param {string} meta.replyTo
     * @param {string} meta.correlationId
     * @param {boolean} [handle=true] - whether to handle the error here
     *
     * @return {Promise}
     */
    async send(topicName, content, meta, handler = true) {
        const topic = this.client.topic(topicName);
        const publishPromise = topic.publish(Buffer.from(JSON.stringify({
            content,
            meta,
        })));
        if (handler === false) {
            return;
        }
        await publishPromise.catch((err) => {
            this.error(err, {
                topicName,
                message: content,
                options: meta,
            });
        });
    }
    /**
     * Just send without any formating
     *
     * @param {string} topicName
     * @param {Buffer} data - the data to be sent
     * @param {boolean} [handle=true] - whether to handle the error here
     *
     * @return {Promise}
     */
    async sendWithoutCover(topicName, data, handler = true) {
        const topic = this.client.topic(topicName);
        const publishPromise = topic.publish(data);
        if (handler === false) {
            return;
        }
        await publishPromise.catch((err) => {
            this.error(err, {
                topicName,
                message: data,
            });
        });
    }
}
module.exports = PubSub;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUHViU3ViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL1B1YlN1Yi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLGlEQUF3RjtBQUN4RiwwRUFBeUM7QUFhekM7O0dBRUc7QUFDSCxNQUFNLE1BQU07SUFDVjs7OztPQUlHO0lBQ0gsSUFBSSxDQUFTO0lBQ2IsT0FBTyxDQUFlO0lBQ3RCLE1BQU0sQ0FBZTtJQUNyQixNQUFNLENBQWE7SUFDbkIsTUFBTSxDQUF5QjtJQUUvQixZQUFZLElBQVksRUFBRSxPQUFxQixFQUFFLE1BQW9CO1FBQ25FLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO1FBQ2pCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxvQkFBb0IsRUFBRSxHQUFHLEVBQUUsR0FBRyxNQUFNLEVBQUUsQ0FBQztRQUN2RCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQztRQUNuQixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNuQixDQUFDO0lBRUQsR0FBRyxDQUFDLE9BQWUsRUFBRSxJQUE4QjtRQUNqRCxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUU7WUFDdkIsT0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2xCLE9BQU87WUFDUCxJQUFJO1NBQ0wsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sQ0FBQyxPQUFlLEVBQUUsSUFBOEI7UUFDckQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFO1lBQzNCLE9BQU8sRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNsQixPQUFPO1lBQ1AsSUFBSTtTQUNMLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsR0FBVSxFQUFFLElBQThCO1FBQzlDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFB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