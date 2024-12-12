// frontend/hooks/useMessageQueue.js

import { useState, useCallback, useEffect, useRef } from 'react';
import { Toast } from '../components/Toast';

export const useMessageQueue = (socketRef, currentUser) => {
    const [messageStates, setMessageStates] = useState(new Map());
    const retryTimeoutsRef = useRef(new Map());
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000;

    const updateMessageState = useCallback((tempId, status, data = null) => {
        setMessageStates(prev => {
            const newStates = new Map(prev);
            if (status === 'completed') {
                newStates.delete(tempId);
            } else {
                newStates.set(tempId, { status, ...data });
            }
            return newStates;
        });
    }, []);

    const handleMessageRetry = useCallback(async (tempId) => {
        const messageData = messageStates.get(tempId);
        if (!messageData) return;

        const retryCount = messageData.retryCount || 0;
        if (retryCount >= MAX_RETRIES) {
            updateMessageState(tempId, 'failed', {
                error: '최대 재시도 횟수를 초과했습니다.',
                ...messageData
            });
            Toast.error('메시지 전송이 실패했습니다.');
            return;
        }

        try {
            updateMessageState(tempId, 'retrying', {
                ...messageData,
                retryCount: retryCount + 1
            });

            socketRef.current.emit('chatMessage', {
                ...messageData.originalMessage,
                tempId,
                isRetry: true
            });

            // 재시도 타임아웃 설정
            const timeoutId = setTimeout(() => {
                const currentState = messageStates.get(tempId);
                if (currentState?.status === 'retrying') {
                    handleMessageRetry(tempId);
                }
            }, RETRY_DELAY);

            retryTimeoutsRef.current.set(tempId, timeoutId);

        } catch (error) {
            console.error('Message retry error:', error);
            updateMessageState(tempId, 'failed', {
                error: error.message,
                ...messageData
            });
        }
    }, [messageStates, socketRef, updateMessageState]);

    useEffect(() => {
        if (!socketRef.current) return;

        const handleMessageQueued = ({ tempId, queuedAt }) => {
            updateMessageState(tempId, 'queued', { queuedAt });
        };

        const handleMessageProcessed = ({ tempId, finalMessage }) => {
            const timeoutId = retryTimeoutsRef.current.get(tempId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                retryTimeoutsRef.current.delete(tempId);
            }
            updateMessageState(tempId, 'completed', { finalMessage });
        };

        const handleMessageError = ({ tempId, error }) => {
            const messageData = messageStates.get(tempId);
            if (messageData) {
                handleMessageRetry(tempId);
            }
        };

        socketRef.current.on('messageQueued', handleMessageQueued);
        socketRef.current.on('messageProcessed', handleMessageProcessed);
        socketRef.current.on('messageError', handleMessageError);

        return () => {
            socketRef.current?.off('messageQueued', handleMessageQueued);
            socketRef.current?.off('messageProcessed', handleMessageProcessed);
            socketRef.current?.off('messageError', handleMessageError);

            // Clear all timeouts
            retryTimeoutsRef.current.forEach(timeoutId => {
                clearTimeout(timeoutId);
            });
            retryTimeoutsRef.current.clear();
        };
    }, [socketRef, updateMessageState, handleMessageRetry]);

    return {
        messageStates,
        updateMessageState,
        handleMessageRetry
    };
};