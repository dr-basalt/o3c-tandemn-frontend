import dbConnect from '../database';
import Conversation, { IConversation } from '../models/Conversation';
import Message, { IMessage } from '../models/Message';
import { encryptForUser, decryptForUser, hashForIndex } from '../encryption';

export interface ConversationData {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageAt: string;
}

export interface MessageData {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
  metadata?: {
    backend?: 'o3c' | 'openrouter' | 'mock';
    processingTime?: number;
    temperature?: number;
    maxTokens?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export class ConversationService {
  /**
   * Create a new conversation for a user
   */
  static async createConversation(
    userId: string,
    title: string,
    modelId: string
  ): Promise<ConversationData> {
    await dbConnect();

    const encryptedTitle = encryptForUser(title, userId);
    const userIdHash = hashForIndex(userId);

    const conversation = new Conversation({
      userId,
      userIdHash,
      title: encryptedTitle,
      modelId,
    });

    await conversation.save();

    return {
      id: conversation._id.toString(),
      title,
      modelId: conversation.modelId,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
    };
  }

  /**
   * Get all conversations for a user (decrypted)
   */
  static async getUserConversations(userId: string): Promise<ConversationData[]> {
    await dbConnect();

    const conversations = await Conversation.find({ userId })
      .sort({ lastMessageAt: -1 })
      .limit(50);

    const validConversations: ConversationData[] = [];
    const invalidConversationIds: string[] = [];

    for (const conv of conversations) {
      let title;
      let isValid = true;

      try {
        title = decryptForUser(conv.title, userId);
      } catch (error) {
        isValid = false;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        
        // Only log once per conversation to reduce spam
        if (!this.loggedFailures?.has(conv._id.toString())) {
          console.warn(`Failed to decrypt conversation title for ${conv._id}, using fallback:`, errorMsg);
          
          // Initialize logged failures set if not exists
          if (!this.loggedFailures) {
            this.loggedFailures = new Set();
          }
          this.loggedFailures.add(conv._id.toString());
        }
        
        // Check if this is a corrupted or foreign conversation
        if (errorMsg.includes('Data integrity check failed or wrong user') || 
            errorMsg.includes('bad decrypt') ||
            errorMsg.includes('error:1C800064')) {
          invalidConversationIds.push(conv._id.toString());
          continue; // Skip this conversation entirely
        }
        
        title = `Conversation ${conv._id.toString().slice(-6)}`; // Fallback title for other errors
      }

      validConversations.push({
        id: conv._id.toString(),
        title,
        modelId: conv.modelId,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
        messageCount: conv.messageCount,
        lastMessageAt: conv.lastMessageAt.toISOString(),
      });
    }

    // Clean up invalid conversations in the background (don't await to avoid slowing down the response)
    if (invalidConversationIds.length > 0) {
      this.cleanupInvalidConversations(invalidConversationIds, userId).catch(error => {
        console.error('Background cleanup of invalid conversations failed:', error);
      });
    }

    return validConversations;
  }

  // Static property to track logged failures and prevent spam
  private static loggedFailures?: Set<string>;

  /**
   * Clean up invalid conversations that cannot be decrypted
   */
  static async cleanupInvalidConversations(conversationIds: string[], userId: string): Promise<void> {
    await dbConnect();

    console.log(`🧹 Cleaning up ${conversationIds.length} invalid conversations for user ${userId}`);

    try {
      // Delete messages associated with invalid conversations
      await Message.deleteMany({ 
        conversationId: { $in: conversationIds }, 
        userId 
      });

      // Delete the invalid conversations
      const result = await Conversation.deleteMany({ 
        _id: { $in: conversationIds }, 
        userId 
      });

      console.log(`✅ Cleaned up ${result.deletedCount} invalid conversations and their messages`);
    } catch (error) {
      console.error('❌ Failed to cleanup invalid conversations:', error);
    }
  }

  /**
   * Get a specific conversation (with access control)
   */
  static async getConversation(conversationId: string, userId: string): Promise<ConversationData | null> {
    await dbConnect();

    const conversation = await Conversation.findOne({ _id: conversationId, userId });
    if (!conversation) return null;

    let title;
    try {
      title = decryptForUser(conversation.title, userId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to decrypt conversation title for ${conversation._id}, using fallback:`, errorMsg);
      
      // If this is a corrupted conversation, delete it
      if (errorMsg.includes('Data integrity check failed or wrong user') || 
          errorMsg.includes('bad decrypt') ||
          errorMsg.includes('error:1C800064')) {
        console.log(`🧹 Deleting corrupted conversation ${conversation._id}`);
        this.cleanupInvalidConversations([conversation._id.toString()], userId).catch(console.error);
        return null; // Return null so the caller knows it's gone
      }
      
      title = `Conversation ${conversation._id.toString().slice(-6)}`;
    }

    return {
      id: conversation._id.toString(),
      title,
      modelId: conversation.modelId,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
    };
  }

  /**
   * Add a message to a conversation
   */
  static async addMessage(
    conversationId: string,
    userId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    modelId?: string,
    tokenUsage?: MessageData['tokenUsage'],
    metadata?: MessageData['metadata']
  ): Promise<MessageData> {
    await dbConnect();

    // Verify user owns the conversation
    const conversation = await Conversation.findOne({ _id: conversationId, userId });
    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    const encryptedContent = encryptForUser(content, userId);
    const userIdHash = hashForIndex(userId);

    const message = new Message({
      conversationId,
      userId,
      userIdHash,
      role,
      content: encryptedContent,
      modelId,
      tokenUsage,
      metadata,
    });

    await message.save();

    // Update conversation stats
    await Conversation.findByIdAndUpdate(conversationId, {
      $inc: { messageCount: 1 },
      $set: { lastMessageAt: new Date() },
    });

    return {
      id: message._id.toString(),
      conversationId,
      role,
      content,
      modelId,
      tokenUsage,
      metadata,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };
  }

  /**
   * Get messages for a conversation (with access control and decryption)
   */
  static async getMessages(conversationId: string, userId: string, limit = 100): Promise<MessageData[]> {
    await dbConnect();

    // Verify user owns the conversation
    const conversation = await Conversation.findOne({ _id: conversationId, userId });
    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    const messages = await Message.find({ conversationId, userId })
      .sort({ createdAt: 1 })
      .limit(limit);

    return messages.map(msg => ({
      id: msg._id.toString(),
      conversationId: msg.conversationId,
      role: msg.role,
      content: decryptForUser(msg.content, userId),
      modelId: msg.modelId,
      tokenUsage: msg.tokenUsage,
      metadata: msg.metadata,
      createdAt: msg.createdAt.toISOString(),
      updatedAt: msg.updatedAt.toISOString(),
    }));
  }

  /**
   * Delete a conversation and all its messages (with access control)
   */
  static async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
    await dbConnect();

    // Verify user owns the conversation
    const conversation = await Conversation.findOne({ _id: conversationId, userId });
    if (!conversation) {
      return false;
    }

    // Delete all messages in the conversation
    await Message.deleteMany({ conversationId, userId });

    // Delete the conversation
    await Conversation.findOneAndDelete({ _id: conversationId, userId });

    return true;
  }

  /**
   * Update conversation title
   */
  static async updateConversationTitle(
    conversationId: string,
    userId: string,
    newTitle: string
  ): Promise<boolean> {
    await dbConnect();

    const encryptedTitle = encryptForUser(newTitle, userId);

    const result = await Conversation.findOneAndUpdate(
      { _id: conversationId, userId },
      { title: encryptedTitle },
      { new: true }
    );

    return !!result;
  }

  /**
   * Utility function to manually clean up all invalid conversations for a user
   * This can be called periodically or on-demand to clean up corrupted data
   */
  static async cleanupAllInvalidConversations(userId: string): Promise<{ cleaned: number; total: number }> {
    await dbConnect();

    const conversations = await Conversation.find({ userId });
    const invalidConversationIds: string[] = [];
    let total = conversations.length;

    console.log(`🔍 Checking ${total} conversations for user ${userId}`);

    for (const conv of conversations) {
      try {
        decryptForUser(conv.title, userId);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMsg.includes('Data integrity check failed or wrong user') || 
            errorMsg.includes('bad decrypt') ||
            errorMsg.includes('error:1C800064')) {
          invalidConversationIds.push(conv._id.toString());
        }
      }
    }

    if (invalidConversationIds.length > 0) {
      await this.cleanupInvalidConversations(invalidConversationIds, userId);
    }

    return {
      cleaned: invalidConversationIds.length,
      total: total
    };
  }
}