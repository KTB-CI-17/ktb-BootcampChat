import { useState, useCallback, useRef } from 'react';
import { Toast } from '../components/Toast';
import fileService from '../services/fileService';
import {useMessageQueue} from "./useMessageQueue";
import { useEffect } from 'react';

export const useMessageHandling = (socketRef, currentUser, router, handleSessionError, messages = []) => {
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [filePreview, setFilePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [pendingMessages, setPendingMessages] = useState(new Map());
  const [queuedMessages, setQueuedMessages] = useState(new Map());
  const messageTimeoutsRef = useRef(new Map());
  const { messageStates, updateMessageState, handleMessageRetry } = useMessageQueue(socketRef, currentUser);

// 임시 메시지 생성 함수
  const createTempMessage = useCallback((content, type = 'text', fileData = null) => {
    return {
      _id: `temp-${Date.now()}`,
      content,
      sender: currentUser,
      type,
      fileData,
      timestamp: new Date(),
      isPending: true,
      room: router?.query?.room
    };
  }, [currentUser, router?.query?.room]);

    // 메시지 큐 상태 업데이트 함수
    const updateMessageQueue = useCallback((tempId, status, finalMessage = null) => {
        setPendingMessages(prev => {
            const newPending = new Map(prev);
            if (status === 'completed') {
                newPending.delete(tempId);
            } else {
                newPending.set(tempId, { status, message: finalMessage || prev.get(tempId)?.message });
            }
            return newPending;
        });
    }, []);

  // 메시지 타임아웃 처리
  const handleMessageTimeout = useCallback((tempId) => {
    updateMessageQueue(tempId, 'failed');
    Toast.error('메시지 전송이 실패했습니다. 다시 시도해주세요.');
  }, [updateMessageQueue]);

 const handleMessageChange = useCallback((e) => {
   const newValue = e.target.value;
   setMessage(newValue);

   const cursorPosition = e.target.selectionStart;
   const textBeforeCursor = newValue.slice(0, cursorPosition);
   const atSymbolIndex = textBeforeCursor.lastIndexOf('@');

   if (atSymbolIndex !== -1) {
     const mentionText = textBeforeCursor.slice(atSymbolIndex + 1);
     if (!mentionText.includes(' ')) {
       setMentionFilter(mentionText.toLowerCase());
       setShowMentionList(true);
       setMentionIndex(0);
       return;
     }
   }
   
   setShowMentionList(false);
 }, []);

 const handleLoadMore = useCallback(async () => {
   if (!socketRef.current?.connected) {
     console.warn('Cannot load messages: Socket not connected');
     return;
   }

   try {
     if (loadingMessages) {
       console.log('Already loading messages, skipping...');
       return;
     }

     setLoadingMessages(true);
     const firstMessageTimestamp = messages[0]?.timestamp;

     console.log('Loading more messages:', {
       roomId: router?.query?.room,
       before: firstMessageTimestamp,
       currentMessageCount: messages.length
     });

     // Promise를 반환하도록 수정
     return new Promise((resolve, reject) => {
       const timeout = setTimeout(() => {
         setLoadingMessages(false);
         reject(new Error('Message loading timed out'));
       }, 10000);

       socketRef.current.emit('fetchPreviousMessages', {
         roomId: router?.query?.room,
         before: firstMessageTimestamp
       });

       socketRef.current.once('previousMessagesLoaded', (response) => {
         clearTimeout(timeout);
         setLoadingMessages(false);
         resolve(response);
       });

       socketRef.current.once('error', (error) => {
         clearTimeout(timeout);
         setLoadingMessages(false);
         reject(error);
       });
     });

   } catch (error) {
     console.error('Load more messages error:', error);
     Toast.error('이전 메시지를 불러오는데 실패했습니다.');
     setLoadingMessages(false);
     throw error;
   }
 }, [socketRef, router?.query?.room, loadingMessages, messages]);

  const handleMessageSubmit = useCallback(async (e) => {
    if (!socketRef.current?.connected || !currentUser) {
      console.error('[Chat] Cannot send message: Socket not connected');
      Toast.error('채팅 서버와 연결이 끊어졌습니다.');
      return;
    }

    const roomId = router?.query?.room;
    if (!roomId) {
      Toast.error('채팅방 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      // 메시지 데이터 준비
      const messageData = {
        room: roomId,  // 명시적으로 roomId 추가
        type: filePreview ? 'file' : 'text',
        content: message.trim(),
        fileData: filePreview,
        tempId: `temp-${Date.now()}`
      };

      // 임시 메시지 상태 설정
      updateMessageState(messageData.tempId, 'pending', {
        originalMessage: messageData,
        timestamp: new Date(),
        sender: currentUser
      });

      // 메시지 전송
      socketRef.current.emit('chatMessage', messageData);

      // UI 상태 초기화
      setMessage('');
      setShowEmojiPicker(false);
      setFilePreview(null);

    } catch (error) {
      console.error('Message submit error:', error);
      Toast.error(error.message || '메시지 전송에 실패했습니다.');
    }
  }, [currentUser, socketRef, updateMessageState, message, filePreview, router?.query?.room]);

  // 컴포넌트 언마운트 시 타임아웃 정리
  useEffect(() => {
    return () => {
      messageTimeoutsRef.current.forEach(timeoutId => {
        clearTimeout(timeoutId);
      });
      messageTimeoutsRef.current.clear();
    };
  }, []);

  // Socket 이벤트 리스너 설정
  useEffect(() => {
    if (!socketRef.current) return;

    // 메시지 처리 완료 이벤트
    const handleMessageProcessed = (message) => {
      if (!message?._id) return;

      // pending 메시지 찾기
      pendingMessages.forEach((pendingData, tempId) => {
        if (pendingData.message?.content === message.content &&
            pendingData.message?.sender?._id === message.sender) {
          // 타임아웃 제거
          const timeoutId = messageTimeoutsRef.current.get(tempId);
          if (timeoutId) {
            clearTimeout(timeoutId);
            messageTimeoutsRef.current.delete(tempId);
          }

          // pending 상태 제거
          updateMessageQueue(tempId, 'completed');
        }
      });
    };

    socketRef.current.on('message', handleMessageProcessed);

    return () => {
      socketRef.current?.off('message', handleMessageProcessed);
    };
  }, [socketRef, pendingMessages, updateMessageQueue]);

 const handleEmojiToggle = useCallback(() => {
   setShowEmojiPicker(prev => !prev);
 }, []);

 const getFilteredParticipants = useCallback((room) => {
   if (!room?.participants) return [];

   const allParticipants = [
     {
       _id: 'wayneAI',
       name: 'wayneAI',
       email: 'ai@wayne.ai',
       isAI: true
     },
     {
       _id: 'consultingAI',
       name: 'consultingAI',
       email: 'ai@consulting.ai',
       isAI: true
     },
     ...room.participants
   ];

   return allParticipants.filter(user => 
     user.name.toLowerCase().includes(mentionFilter) ||
     user.email.toLowerCase().includes(mentionFilter)
   );
 }, [mentionFilter]);

 const insertMention = useCallback((messageInputRef, user) => {
   if (!messageInputRef?.current) return;

   const cursorPosition = messageInputRef.current.selectionStart;
   const textBeforeCursor = message.slice(0, cursorPosition);
   const atSymbolIndex = textBeforeCursor.lastIndexOf('@');

   if (atSymbolIndex !== -1) {
     const textBeforeAt = message.slice(0, atSymbolIndex);
     const newMessage = 
       textBeforeAt +
       `@${user.name} ` +
       message.slice(cursorPosition);

     setMessage(newMessage);
     setShowMentionList(false);

     setTimeout(() => {
       const newPosition = atSymbolIndex + user.name.length + 2;
       messageInputRef.current.focus();
       messageInputRef.current.setSelectionRange(newPosition, newPosition);
     }, 0);
   }
 }, [message]);

 const removeFilePreview = useCallback(() => {
   setFilePreview(null);
   setUploadError(null);
   setUploadProgress(0);
 }, []);

 return {
   message,
   showEmojiPicker,
   showMentionList,
   mentionFilter,
   mentionIndex,
   filePreview,
   uploading,
   uploadProgress,
   uploadError,
   loadingMessages,
   setMessage,
   setShowEmojiPicker,
   setShowMentionList,
   setMentionFilter,
   setMentionIndex,
   setFilePreview,
   setLoadingMessages,
   handleMessageChange,
   handleMessageSubmit,
   handleEmojiToggle,
   handleLoadMore,
   getFilteredParticipants,
   insertMention,
   removeFilePreview,
   pendingMessages,
   queuedMessages,
   updateMessageQueue,
   createTempMessage,
   messageStates,
   handleMessageRetry
 };
};

export default useMessageHandling;