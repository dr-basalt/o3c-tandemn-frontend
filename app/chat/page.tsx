'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { Plus, MessageSquare, Settings, Send, Paperclip, Globe, Menu, X, Zap, ChevronDown, Check, Square, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  } from '@/components/ui/dialog';
  import { ThinkingMode } from '@/components/thinking-mode';
import { useRoomsStore } from '@/store/rooms';
import { ChatRoom, Message, Model } from '@/mock/types';
import { TandemnHealth } from '@/components/tandemn-health';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { fetchDeployments, getDeployedModelIds } from '@/lib/deployment-utils';
import { Skeleton } from '@/components/ui/skeleton';

// Dynamically import heavy components
const GPUUtilization = dynamic(() => import('@/components/gpu-utilization').then(mod => ({ default: mod.GPUUtilization })), {
  loading: () => (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  ),
  ssr: false,
});

function ChatPageContent() {
  const { user, isSignedIn } = useUser();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q');
  const initialModelId = searchParams.get('model');
  
  const {
    rooms,
    activeRoomId,
    messages,
    setRooms,
    addRoom,
    removeRoom,
    setActiveRoom,
    addMessage,
    updateMessage,
    loadMessages,
  } = useRoomsStore();

  // Custom function to handle room selection and load messages
  const handleSetActiveRoom = (roomId: string | null) => {
    setActiveRoom(roomId);
    // Load messages when room is selected
    if (roomId && !messages[roomId]) {
      loadMessages(roomId);
    }
  };

  const [models, setModels] = useState<Model[]>([]);
  const [currentModel, setCurrentModel] = useState<Model | null>(null);
  const [inputMessage, setInputMessage] = useState(initialQuery || '');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [userCredits, setUserCredits] = useState<number>(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Deployment status tracking
  const [deployedModelIds, setDeployedModelIds] = useState<Set<string>>(new Set());
  const [isRefreshingDeployments, setIsRefreshingDeployments] = useState(false);
  
  // Thinking mode state for streaming
  const [streamingThinking, setStreamingThinking] = useState<{[messageId: string]: string}>({});
  const [streamingRegular, setStreamingRegular] = useState<{[messageId: string]: string}>({});
  const [thinkingFinished, setThinkingFinished] = useState<{[messageId: string]: boolean}>({});

  // AbortController ref for cancelling streaming requests
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeRoom = rooms.find(room => room.id === activeRoomId);
  const roomMessages = activeRoomId ? messages[activeRoomId] || [] : [];

  // Fetch user credits
  const fetchUserCredits = async () => {
    try {
      const response = await fetch('/api/credits');
      if (response.ok) {
        const data = await response.json();
        setUserCredits(data.balance || 0);
      }
    } catch (error) {
      console.error('Failed to fetch user credits:', error);
    }
  };

  // Fetch deployment status
  const fetchDeploymentStatus = async () => {
    setIsRefreshingDeployments(true);
    try {
      const deployments = await fetchDeployments();
      const deployedIds = getDeployedModelIds(deployments);
      setDeployedModelIds(deployedIds);
      console.log('Deployed models:', Array.from(deployedIds));
    } catch (error) {
      console.error('Failed to fetch deployment status:', error);
    } finally {
      setIsRefreshingDeployments(false);
    }
  };

  // Fetch models on mount - OPTIMIZED WITH PARALLEL FETCHING
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // Fetch all data in parallel instead of sequentially
        const [modelsResponse, deploymentsResult, creditsResponse] = await Promise.all([
          fetch('/api/models?limit=50&sort=popularity'),
          fetchDeployments().catch((err) => {
            console.error('Failed to fetch deployments:', err);
            return null;
          }),
          fetch('/api/credits').catch(() => null),
        ]);

        // Process models
        if (modelsResponse.ok) {
          const modelsData = await modelsResponse.json();
          setModels(modelsData.items || []);
          
          if (modelsData.items?.length > 0) {
            // If there's an initial model ID from URL, use that
            if (initialModelId) {
              const initialModel = modelsData.items.find((model: Model) => model.id === initialModelId);
              if (initialModel) {
                setCurrentModel(initialModel);
              } else {
                // Fallback if URL model not found
                const llamaModel = modelsData.items.find((model: Model) => 
                  model.id === 'casperhansen/llama-3.3-70b-instruct-awq' || 
                  model.name.toLowerCase().includes('llama 3.3 70b instruct (awq)')
                );
                setCurrentModel(llamaModel || modelsData.items[0]);
              }
            } else {
              // Otherwise, prefer Llama 3.3 70B Instruct (AWQ) as the default model
              const llamaModel = modelsData.items.find((model: Model) => 
                model.id === 'casperhansen/llama-3.3-70b-instruct-awq' || 
                model.name.toLowerCase().includes('llama 3.3 70b instruct (awq)')
              );
              setCurrentModel(llamaModel || modelsData.items[0]);
            }
          }
        }

        // Process deployments
        if (deploymentsResult) {
          const deployedIds = getDeployedModelIds(deploymentsResult);
          setDeployedModelIds(deployedIds);
        }
        setIsRefreshingDeployments(false);

        // Process credits
        if (creditsResponse && creditsResponse.ok) {
          const creditsData = await creditsResponse.json();
          setUserCredits(creditsData.balance || 0);
        }
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
        setIsRefreshingDeployments(false);
      }
    };

    fetchInitialData();
  }, [initialModelId]);

  // Fetch user rooms on mount
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const response = await fetch('/api/chat/rooms');
        const data = await response.json();
        setRooms(data.items || []);
        
        // If we have a query but no active room, create one
        if (initialQuery && data.items?.length === 0 && currentModel) {
          createNewRoom(initialQuery);
        }
      } catch (error) {
        console.error('Failed to fetch rooms:', error);
      }
    };
    
    if (isSignedIn) {
      fetchRooms();
    }
  }, [isSignedIn, currentModel, initialQuery]);

  const createNewRoom = async (title?: string) => {
    if (!currentModel) return;
    
    try {
      const response = await fetch('/api/chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || `Playground with ${currentModel.name}`,
          modelId: currentModel.id,
        }),
      });
      
      const newRoom = await response.json();
      addRoom(newRoom);
      handleSetActiveRoom(newRoom.id);
      
      // If we had an initial query, send it
      if (initialQuery && title === initialQuery) {
        setTimeout(() => sendMessage(initialQuery), 100);
      }
    } catch (error) {
      console.error('Failed to create room:', error);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    setRoomToDelete(roomId);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteRoom = async () => {
    if (!roomToDelete) return;
    
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/chat/rooms/${roomToDelete}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete room');
      }
      
      // Remove from local state
      removeRoom(roomToDelete);
      
      // Close dialog
      setDeleteDialogOpen(false);
      setRoomToDelete(null);
    } catch (error) {
      console.error('Failed to delete room:', error);
      // You could add a toast notification here to show error
    } finally {
      setIsDeleting(false);
    }
  };

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
        console.log('🛑 Streaming stopped by user');
      } catch (error) {
        console.log('⚠️ Error aborting request:', error);
      } finally {
        abortControllerRef.current = null;
        setIsStreaming(false);
        // GPU panel stays visible
      }
    }
  };

  const sendMessage = async (content: string = inputMessage, overrideRoomId?: string) => {
    const roomId = overrideRoomId ?? activeRoomId;
    if (!content.trim() || !roomId || !currentModel || isStreaming) return;

    // Check if user has sufficient credits before sending
    if (userCredits <= 0) {
      alert('⚠️ You are out of credits - Buy more credits to continue chatting!');
      return;
    }

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: content.trim(),
      createdAt: new Date().toISOString(),
      roomId,
    };

    addMessage(roomId, userMessage);
    setInputMessage('');
    setIsStreaming(true);
    // GPU panel is always visible now

    // Create new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Build conversation history including the new user message
      const existingMessages = messages[roomId] || [];
      const conversationHistory = [
        ...existingMessages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        { role: 'user', content: content.trim() }
      ];

      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: currentModel.id,
          roomId,
          messages: conversationHistory,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 402) {
          const requiredCredits = errorData.requiredCredits || 0;
          const currentCredits = errorData.currentCredits || 0;
          throw new Error(`Insufficient credits: Need $${requiredCredits.toFixed(4)} but only have $${currentCredits.toFixed(4)}. Please purchase more credits.`);
        }
        throw new Error(errorData.error || 'Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      let assistantContent = '';
      const assistantMessageId = `msg_${Date.now()}_assistant`;
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        roomId,
      };

      addMessage(roomId, assistantMessage);

    // Initialize only regular content - thinking will be initialized only if <think> detected
    setStreamingRegular(prev => ({ ...prev, [assistantMessageId]: '' }));
    
    let fullContent = '';
    let currentThinking = '';
    let currentRegular = '';
    let wasInThinking = false;
    let thinkingModeActivated = false;

      // Create a streaming TextDecoder to handle UTF-8 properly
      const decoder = new TextDecoder('utf-8');

      // Function to restore common emojis from unicode replacement characters
      const restoreEmojis = (text: string): string => {
        return text
          // Common emoji patterns
          .replace(/��/g, '🔥')  // Double replacement often fire emoji
          .replace(/�(?=\s|$)/g, '👋')  // Standalone replacement often wave emoji
          .replace(/(?<=\s)�/g, '🎉')  // After space often celebration
          .replace(/�{2,}/g, '🚀')  // Multiple replacements often rocket
          .replace(/�{3,}/g, '🎯')  // Three or more often target
          // Specific greeting patterns from your example
          .replace(/YOOOOO.*�.*�/g, 'YOOOOO BACK! 👋🔥')
          .replace(/What's.*crackin.*\?.*�.*�/g, "What's crackin'? 🎉🚀")
          // Common exclamation patterns
          .replace(/!(.*?)�/g, '! $1🎉')
          .replace(/\?(.*?)�/g, '? $1🤔')
          // Clean up any remaining isolated replacement characters
          .replace(/\s�\s/g, ' 😊 ')  // Isolated replacement with spaces
          .replace(/^�/g, '👋')  // At start of message
          .replace(/�$/g, '✨'); // At end of message
      };

      // Read the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true }); // Enable streaming for proper emoji handling
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                // Restore emojis before adding to content
                const restoredText = restoreEmojis(data.text);
                fullContent += restoredText;
                
                // Parse the content in real-time with improved logic
                const parseStreamingContent = (content: string) => {
                  let tempThinking = '';
                  let tempRegular = '';
                  let tempContent = content;
                  
                  // Check if we're currently inside a thinking block
                  const lastOpenThink = tempContent.lastIndexOf('<think>');
                  const lastCloseThink = tempContent.lastIndexOf('</think>');
                  const isInThinking = lastOpenThink > lastCloseThink;
                  const hasCompletedThinking = tempContent.includes('</think>');
                  
                  if (isInThinking) {
                    // Split at the last <think> tag
                    const beforeThink = tempContent.substring(0, lastOpenThink);
                    const afterThink = tempContent.substring(lastOpenThink + 7); // +7 for '<think>'
                    
                    // Process completed thinking blocks in the before part
                    let processedBefore = beforeThink;
                    const completedThinking = processedBefore.match(/<think>([\s\S]*?)<\/think>/g);
                    if (completedThinking) {
                      for (const match of completedThinking) {
                        const thinkContent = match.replace(/<think>/, '').replace(/<\/think>/, '');
                        tempThinking += thinkContent;
                        processedBefore = processedBefore.replace(match, '');
                      }
                    }
                    
                    // Add current streaming thinking content
                    tempThinking += afterThink;
                    tempRegular = processedBefore.replace(/<think>/g, '').trim();
                    
                    // Debug logging for thinking content
                    if (afterThink && afterThink.trim()) {
                      console.log('🧠 STREAMING THINKING:', afterThink.slice(0, 30) + '...');
                    }
                  } else {
                    // No active thinking - process all completed blocks
                    const thinkingMatches = tempContent.match(/<think>([\s\S]*?)<\/think>/g);
                    if (thinkingMatches) {
                      for (const match of thinkingMatches) {
                        const thinkContent = match.replace(/<think>/, '').replace(/<\/think>/, '');
                        tempThinking += thinkContent;
                        tempContent = tempContent.replace(match, '');
                      }
                    }
                    tempRegular = tempContent.replace(/<think>/g, '').trim();
                  }
                  
                  // Check if thinking just finished (transition from thinking to regular)
                  if (!isInThinking && hasCompletedThinking && wasInThinking) {
                    console.log('🧠 THINKING JUST FINISHED! Transitioning to regular content...');
                    setThinkingFinished(prev => ({ ...prev, [assistantMessageId]: true }));
                  }
                  
                  // Track if we were in thinking for next iteration
                  wasInThinking = isInThinking || hasCompletedThinking;
                  
                  return { thinking: tempThinking, regular: tempRegular, isInThinking, hasCompletedThinking };
                };
                
                const parsed = parseStreamingContent(fullContent);
                
                // Debug after parsing
                console.log('🔍 PARSING DEBUG:', {
                  isInThinking: parsed.isInThinking,
                  hasCompletedThinking: parsed.hasCompletedThinking,
                  thinkingLength: parsed.thinking.length,
                  regularLength: parsed.regular.length,
                  fullContentLength: fullContent.length,
                  thinkingContent: parsed.thinking.slice(0, 100) + '...'
                });
                
                // Force thinking mode to show if we detect <think> tag (only once per message)
                if (fullContent.includes('<think>') && !thinkingModeActivated) {
                  // Special case for Qwen - ignore empty thinking blocks
                  const isQwen = currentModel?.name.toLowerCase().includes('qwen');
                  
                  if (isQwen) {
                    // Check if Qwen has empty thinking blocks
                    const emptyThinkingMatches = fullContent.match(/<think>\s*<\/think>/g);
                    const hasRealThinking = parsed.thinking && parsed.thinking.trim().length > 0;
                    
                    if (emptyThinkingMatches && !hasRealThinking) {
                      console.log('🔕 QWEN: Ignoring empty thinking block(s)');
                      // Don't activate thinking mode for Qwen empty blocks
                    } else {
                      console.log('🧠 QWEN THINKING MODE ACTIVATED! (has real content)');
                      thinkingModeActivated = true;
                      setStreamingThinking(prev => ({ ...prev, [assistantMessageId]: parsed.thinking }));
                      setThinkingFinished(prev => ({ ...prev, [assistantMessageId]: false }));
                    }
                  } else {
                    console.log('🧠 THINKING MODE ACTIVATED!');
                    thinkingModeActivated = true;
                    setStreamingThinking(prev => ({ ...prev, [assistantMessageId]: parsed.thinking }));
                    setThinkingFinished(prev => ({ ...prev, [assistantMessageId]: false }));
                  }
                }
                
                // Update streaming states with debug logging (only if thinking mode is active)
                if (thinkingModeActivated) {
                  const restoredThinking = restoreEmojis(parsed.thinking);
                  // Always update thinking content for real-time streaming
                  if (restoredThinking !== currentThinking) {
                    currentThinking = restoredThinking;
                    console.log('🧠 THINKING UPDATE:', currentThinking.length, 'chars:', currentThinking.slice(0, 50) + '...');
                    // Update thinking content
                    setStreamingThinking(prev => ({ 
                      ...prev, 
                      [assistantMessageId]: currentThinking
                    }));
                  }
                }
                
                if (parsed.regular !== currentRegular) {
                  currentRegular = restoreEmojis(parsed.regular);
                  console.log('💬 REGULAR UPDATE:', currentRegular.slice(0, 50) + '...');
                  setStreamingRegular(prev => ({ ...prev, [assistantMessageId]: currentRegular }));
                }
                
                // Apply emoji restoration to full content and update the message
                const finalContent = restoreEmojis(fullContent);
                updateMessage(roomId, assistantMessageId, { content: finalContent });
              }
              if (data.done) {
                // Clean up streaming states
                setStreamingThinking(prev => {
                  const newState = { ...prev };
                  delete newState[assistantMessageId];
                  return newState;
                });
                setStreamingRegular(prev => {
                  const newState = { ...prev };
                  delete newState[assistantMessageId];
                  return newState;
                });
                setThinkingFinished(prev => {
                  const newState = { ...prev };
                  delete newState[assistantMessageId];
                  return newState;
                });
                
                setIsStreaming(false);
                // GPU panel stays visible - no auto-hide
                // Refresh user credits after successful API call
                fetchUserCredits();
                // Clean up abort controller
                abortControllerRef.current = null;
                return;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      // Check if the error is due to abort first
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('🛑 Request was cancelled by user');
        // Don't log this as an error since it's intentional
      } else {
        console.error('❌ Failed to send message:', error);
      }
      
      setIsStreaming(false);
      // GPU panel stays visible
      abortControllerRef.current = null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = inputMessage.trim();
    if (!content || !currentModel || isStreaming) return;

    if (!activeRoomId) {
      // No room yet — create one, then send with the new ID
      try {
        const res = await fetch('/api/chat/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: content.slice(0, 60),
            modelId: currentModel.id,
          }),
        });
        const newRoom = await res.json();
        addRoom(newRoom);
        handleSetActiveRoom(newRoom.id);
        await sendMessage(content, newRoom.id);
      } catch (err) {
        console.error('Failed to create room:', err);
      }
      return;
    }

    sendMessage(content);
  };

  const samplePrompts = [
    "Explain quantum computing in simple terms",
    "Write a Python function to sort a list",
    "What are the latest trends in AI?",
    "Help me debug this code",
  ];

  // Show sign-in prompt for unauthenticated users
  if (!isSignedIn) {
    return <SignInPrompt pageType="playground" />;
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] relative">
      {/* Mobile Sidebar Toggle */}
      <button
        className="md:hidden fixed top-16 left-4 z-50 p-2 bg-background border rounded-md shadow-sm"
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
      >
        {isSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Rooms Sidebar */}
      <div className={`w-80 border-r bg-muted/10 flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } fixed md:relative z-40 md:z-auto h-full md:h-auto`}>
        <div className="p-4 border-b">
          <Button 
            onClick={() => createNewRoom()} 
            className="w-full"
            disabled={!currentModel}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Conversation
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {rooms.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No conversations yet</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {rooms.map((room) => (
                <Card
                  key={room.id}
                  className={`group cursor-pointer transition-colors hover:bg-muted/50 ${
                    activeRoomId === room.id ? 'bg-muted' : ''
                  }`}
                  onClick={(e) => {
                    // Don't select room if clicking on delete button
                    if ((e.target as HTMLElement).closest('[data-delete-button]')) {
                      return;
                    }
                    handleSetActiveRoom(room.id);
                    setIsSidebarOpen(false);
                  }}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm line-clamp-1">
                      {room.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {new Date(room.createdAt).toLocaleDateString()}
                    </p>
                    </div>
                    <Button
                      data-delete-button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 ml-2"
                      onClick={() => handleDeleteRoom(room.id)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex md:ml-0">
        {/* Chat Column */}
        <div className="flex-1 flex flex-col">
          {activeRoom ? (
            <>
              {/* Model Selection Strip */}
              <div className="border-b p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-sm font-medium">Model:</span>
                    <Select
                      value={currentModel?.id || ''}
                      onValueChange={(modelId) => {
                        const selectedModel = models.find(m => m.id === modelId);
                        if (selectedModel) {
                          // Allow selection even if not deployed - will fallback to OpenRouter
                          setCurrentModel(selectedModel);
                        }
                      }}
                      disabled={isStreaming}
                    >
                      <SelectTrigger className="min-w-[320px] max-w-[600px] w-auto">
                        <SelectValue placeholder="Select a model">
                          {currentModel ? (
                            <div className="flex items-center space-x-2 w-full">
                              <span className="font-medium truncate flex-shrink-0">{currentModel.name}</span>
                              <div className="flex space-x-1 flex-shrink-0">
                                <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                  In: ${currentModel.promptPrice.toFixed(3)}
                                </Badge>
                                <Badge variant="outline" className="text-xs whitespace-nowrap">
                                  Out: ${currentModel.completionPrice.toFixed(3)}
                                </Badge>
                              </div>
                            </div>
                          ) : (
                            'Loading models...'
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="min-w-[320px] max-w-[600px]">
                        {models.map((model) => {
                          const isDeployed = deployedModelIds.has(model.id);
                          return (
                            <SelectItem 
                              key={model.id} 
                              value={model.id}
                            >
                              <div className="flex items-center justify-between w-full min-w-0">
                                <div className="flex items-center space-x-2 min-w-0 flex-1">
                                  <span className="font-medium truncate flex-shrink-0">{model.name}</span>
                                  <div className="flex space-x-1 flex-shrink-0">
                                    <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                      In: ${model.promptPrice.toFixed(3)}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                                      Out: ${model.completionPrice.toFixed(3)}
                                    </Badge>
                                  </div>
                                </div>
                                {currentModel?.id === model.id && (
                                  <Check className="h-4 w-4 ml-2 flex-shrink-0" />
                                )}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchDeploymentStatus}
                    disabled={isRefreshingDeployments}
                    className="ml-2 flex-shrink-0"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshingDeployments ? 'animate-spin' : ''}`} />
                  </Button>
                  {/* Settings button - commented out as requested */}
                  {/* <Button variant="ghost" size="sm">
                    <Settings className="h-4 w-4" />
                  </Button> */}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {roomMessages.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Start a conversation with {currentModel?.name}</p>
                </div>
              ) : (
                roomMessages.map((message) => {
                  const isLastMessage = roomMessages[roomMessages.length - 1].id === message.id;
                  
                  // Check if this message has streaming content
                  const hasStreamingThinking = streamingThinking[message.id];
                  const hasStreamingRegular = streamingRegular[message.id];
                  const isThinkingFinished = thinkingFinished[message.id];
                  
                  // If we have streaming content, use that instead of parsing the stored content
                  if (isStreaming && isLastMessage && (hasStreamingThinking !== undefined || hasStreamingRegular !== undefined)) {
                    return (
                      <div key={message.id} className="space-y-2">
                        {(hasStreamingThinking !== undefined) && (
                          <div className="flex justify-start">
                            <div className="max-w-[85%] md:max-w-[80%]">
                              <ThinkingMode
                                content={hasStreamingThinking || ''}
                                isStreaming={!isThinkingFinished && isStreaming}
                                isFinished={isThinkingFinished || false}
                                className="mb-2"
                              />
                            </div>
                          </div>
                        )}
                        {hasStreamingRegular && (
                          <div className="flex justify-start">
                            <div className="max-w-[85%] md:max-w-[80%] p-3 md:p-4 rounded-lg bg-muted">
                              <p className="text-sm whitespace-pre-wrap">
                                {hasStreamingRegular}
                                <span className="animate-pulse">▊</span>
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Parse thinking content from stored message for completed messages
                  const parseMessageContent = (content: string) => {
                    const thinkingRegex = /<think>([\s\S]*?)<\/think>/g;
                    const parts: Array<{ type: 'text' | 'thinking'; content: string }> = [];
                    let lastIndex = 0;
                    let match;

                    while ((match = thinkingRegex.exec(content)) !== null) {
                      // Add text before thinking tag
                      if (match.index > lastIndex) {
                        const textContent = content.slice(lastIndex, match.index).trim();
                        if (textContent) {
                          parts.push({ type: 'text', content: textContent });
                        }
                      }
                      // Add thinking content
                      parts.push({ type: 'thinking', content: match[1].trim() });
                      lastIndex = match.index + match[0].length;
                    }

                    // Add remaining text after last thinking tag
                    if (lastIndex < content.length) {
                      const textContent = content.slice(lastIndex).trim();
                      if (textContent) {
                        parts.push({ type: 'text', content: textContent });
                      }
                    }

                    // If no thinking tags found, return the whole content as text
                    if (parts.length === 0) {
                      parts.push({ type: 'text', content });
                    }

                    return parts;
                  };

                  const messageParts = message.role === 'assistant' ? parseMessageContent(message.content) : [{ type: 'text' as const, content: message.content }];

                  return (
                    <div key={message.id} className="space-y-2">
                      {message.role === 'assistant' && messageParts.some(part => part.type === 'thinking') && (
                        <div className="flex justify-start">
                          <div className="max-w-[85%] md:max-w-[80%]">
                            <ThinkingMode
                              content={messageParts
                                .filter(part => part.type === 'thinking')
                                .map(part => part.content)
                                .join('\n\n')}
                              isStreaming={false}
                              isFinished={true}
                              className="mb-2"
                            />
                          </div>
                        </div>
                      )}
                      {messageParts.some(part => part.type === 'text' && part.content.trim()) && (
                        <div
                    className={`flex ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[80%] p-3 md:p-4 rounded-lg ${
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">
                              {messageParts
                                .filter(part => part.type === 'text')
                                .map(part => part.content)
                                .join('\n')}
                      </p>
                    </div>
                  </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Area */}
            <div className="border-t p-4">
              {roomMessages.length === 0 && (
                <div className="mb-4 opacity-80">
                  <p className="text-sm text-muted-foreground mb-2">Try these prompts:</p>
                  <div className="flex flex-wrap gap-2">
                    {samplePrompts.map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        onClick={() => setInputMessage(prompt)}
                        className="text-xs opacity-80 hover:opacity-100"
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Model Display - Credits removed */}
              <div className="flex items-center justify-end mb-2 px-1">
                <div className="text-xs text-muted-foreground">
                  {currentModel && `Using ${currentModel.name}`}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col md:flex-row md:items-end space-y-2 md:space-y-0 md:space-x-2">
                <div className="flex-1">
                  {/* <div className="flex items-center space-x-2 mb-2">
                    <Button variant="ghost" size="sm">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <Globe className="h-4 w-4" />
                    </Button>
                  </div> */}
                  <div className="flex space-x-2">
                    <Input
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      placeholder="Type your message..."
                      disabled={isStreaming}
                      className="min-h-[40px] md:min-h-[40px] flex-1"
                    />
                    {isStreaming ? (
                      <Button 
                        type="button" 
                        onClick={stopStreaming}
                        size="icon"
                        variant="destructive"
                        className="h-10 w-10 md:h-9 md:w-9"
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button 
                        type="submit" 
                        disabled={!inputMessage.trim()}
                        size="icon"
                        className="h-10 w-10 md:h-9 md:w-9"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-semibold mb-2">Welcome to Playground</h2>
                <p className="text-muted-foreground mb-4">
                  Type a message below to start a conversation
                </p>
              </div>
            </div>
            {/* Input area shown even without an active room */}
            <div className="border-t p-4">
              <div className="mb-4 opacity-80">
                <p className="text-sm text-muted-foreground mb-2">Try these prompts:</p>
                <div className="flex flex-wrap gap-2">
                  {samplePrompts.map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      size="sm"
                      onClick={() => setInputMessage(prompt)}
                      className="text-xs opacity-80 hover:opacity-100"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
              <form onSubmit={handleSubmit} className="flex space-x-2">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={currentModel ? `Message ${currentModel.name}...` : 'Loading models...'}
                  disabled={isStreaming || !currentModel}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  disabled={!inputMessage.trim() || !currentModel}
                  size="icon"
                  className="h-10 w-10"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        )}
        </div>

        {/* GPU Utilization Panel - Always visible when chat is active */}
        {activeRoom && (
          <div className="w-96 border-l bg-muted/5 p-4 hidden lg:block">
            <GPUUtilization 
              modelName={currentModel?.name}
              isVisible={true}
              isStreaming={isStreaming}
            />
          </div>
        )}

        {/* Tandemn Health Panel - Hidden on mobile */}
        {/* {!showGPUUtilization && (
          <div className="w-96 border-l bg-muted/5 p-4 hidden lg:block">
            <TandemnHealth />
          </div>
        )} */}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Chat</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this chat? This action cannot be undone and all messages in this conversation will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setRoomToDelete(null);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={confirmDeleteRoom}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  );
}
