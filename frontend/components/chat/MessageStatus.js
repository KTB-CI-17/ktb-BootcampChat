// frontend/components/chat/MessageStatus.js
import React from 'react';
import { Loader2, AlertCircle, Check, Clock } from 'lucide-react';

const MessageStatus = ({ status, onRetry }) => {
    const statusConfig = {
        pending: {
            icon: Clock,
            text: '대기 중...',
            color: 'text-gray-400'
        },
        queued: {
            icon: Clock,
            text: '처리 대기 중...',
            color: 'text-blue-400'
        },
        processing: {
            icon: Loader2,
            text: '처리 중...',
            color: 'text-blue-500'
        },
        retrying: {
            icon: Loader2,
            text: '재시도 중...',
            color: 'text-yellow-500'
        },
        failed: {
            icon: AlertCircle,
            text: '실패',
            color: 'text-red-500'
        },
        completed: {
            icon: Check,
            text: '완료',
            color: 'text-green-500'
        }
    };

    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;

    return (
        <div className={`message-status flex items-center gap-1 ${config.color}`}>
            <Icon className="w-4 h-4" />
            <span className="text-xs">{config.text}</span>
            {status === 'failed' && (
                <button
                    onClick={onRetry}
                    className="text-xs text-blue-500 hover:text-blue-600 ml-2"
                >
                    재시도
                </button>
            )}
        </div>
    );
};

export default React.memo(MessageStatus);