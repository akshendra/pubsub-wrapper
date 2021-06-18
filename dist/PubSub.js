"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const pubsub_1 = require("@google-cloud/pubsub");
const safely_parse_json_1 = __importDefault(require("safely-parse-json"));
module.exports = class PubSub {
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
     * @param {Object} _options - tuning params
     * @param {number} _options.ackDeadlineSeconds - number of seconds
     *   after which message will marked nack
     * @param {boolean} [_options.autoAck=false]
     * @param {string} [_options.encoding='utf-8']
     * @param {number} [_options.interval=1] - interval between taking next message
     * @param {number} [_options.maxInProgress=1] - number of message at once
     * @param {string} [_options.pushEndPoint]
     * @param {number} [_options.timeout] - http call
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
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUHViU3ViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL1B1YlN1Yi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7O0FBQUEsaURBQXdGO0FBQ3hGLDBFQUF5QztBQWdCekMsaUJBQVMsTUFBTSxNQUFNO0lBQ25COzs7O09BSUc7SUFDSCxJQUFJLENBQVM7SUFDYixPQUFPLENBQWU7SUFDdEIsTUFBTSxDQUFlO0lBQ3JCLE1BQU0sQ0FBYTtJQUNuQixNQUFNLENBQXlCO0lBRS9CLFlBQVksSUFBWSxFQUFFLE9BQXFCLEVBQUUsTUFBb0I7UUFDbkUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLG9CQUFvQixFQUFFLEdBQUcsRUFBRSxHQUFHLE1BQU0sRUFBRSxDQUFDO1FBQ3ZELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO1FBQ25CLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDO0lBQ25CLENBQUM7SUFFRCxHQUFHLENBQUMsT0FBZSxFQUFFLElBQThCO1FBQ2pELElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRTtZQUN2QixPQUFPLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDbEIsT0FBTztZQUNQLElBQUk7U0FDTCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxDQUFDLE9BQWUsRUFBRSxJQUE4QjtRQUNyRCxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7WUFDM0IsT0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2xCLE9BQU87WUFDUCxJQUFJO1NBQ0wsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxHQUFVLEVBQUUsSUFBOEI7UUFDOUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFO1lB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