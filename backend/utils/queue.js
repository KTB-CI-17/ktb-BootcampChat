// backend/utils/queue.js

const Redis = require('ioredis');
const EventEmitter = require('events');
const redisClient = require('./redisClient');
const Message = require('../models/Message');

class MessageQueue extends EventEmitter {
    constructor() {
        super();
        this.mainQueue = 'chat_messages';
        this.processingQueue = 'processing_messages';
        this.deadLetterQueue = 'dead_letter_messages';
        // this.redis = redisClient; // 이 줄을 아래 줄로 변경
        this.redis = new Redis();  // Redis 클라이언트 직접 생성
        this.maxRetries = 3;
        this.processingTimeout = 30000;
    }

    async enqueue(messageData) {
        try {
            const message = {
                ...messageData,
                attemptCount: 0,
                queuedAt: Date.now()
            };

            await this.redis.rpush(this.mainQueue, JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Message enqueue error:', error);
            return false;
        }
    }

    async processMessage(message) {
        try {
            const { room, sender, content, type, fileData } = message;

            const newMessage = await Message.create({
                room,
                sender,
                content,
                type,
                file: type === 'file' ? fileData?._id : undefined,
                timestamp: new Date()
            });

            await newMessage.populate('sender', 'name email profileImage');

            if (type === 'file') {
                await newMessage.populate('file');
            }

            this.emit('messageProcessed', {
                message: newMessage,
                originalMessage: message
            });

            return true;
        } catch (error) {
            console.error('Message processing error:', error);
            this.emit('messageError', error, message);
            throw error;
        }
    }

    async startProcessing() {
        while (true) {
            try {
                const result = await this.redis
                    .multi()
                    .rpoplpush(this.mainQueue, this.processingQueue)
                    .exec();

                if (!result?.[0]?.[1]) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                const message = JSON.parse(result[0][1]);

                try {
                    await this.processMessage(message);
                    await this.redis.lrem(this.processingQueue, 1, result[0][1]);
                } catch (error) {
                    message.attemptCount = (message.attemptCount || 0) + 1;

                    if (message.attemptCount >= this.maxRetries) {
                        await this.moveToDeadLetter(message, error);
                    } else {
                        await this.enqueue(message);
                    }

                    await this.redis.lrem(this.processingQueue, 1, result[0][1]);
                }

            } catch (error) {
                console.error('Message processing loop error:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    async moveToDeadLetter(message, error) {
        try {
            const deadMessage = {
                ...message,
                error: error.message,
                failedAt: Date.now()
            };

            await this.redis.rpush(this.deadLetterQueue, JSON.stringify(deadMessage));
        } catch (err) {
            console.error('Move to dead letter error:', err);
        }
    }

    async cleanup() {
        try {
            const processingMessages = await this.redis.lrange(this.processingQueue, 0, -1);

            if (processingMessages.length > 0) {
                await this.redis
                    .multi()
                    .del(this.processingQueue)
                    .rpush(this.mainQueue, ...processingMessages)
                    .exec();
            }
        } catch (error) {
            console.error('Queue cleanup error:', error);
        }
    }
}

module.exports = new MessageQueue();