import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const ChatLog = sequelize.define("chat_log", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,                  
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
    },
    session_id: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4
    },
    role: {
        type: DataTypes.ENUM('user', 'assistant', 'system'),
        allowNull: false
    },
    text: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    input_tokens: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    output_tokens: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}, {
    tableName: 'chat_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        { name: 'idx_chat_user', fields: ['user_id', 'created_at'] },
        { name: 'idx_chat_session', fields: ['session_id', 'created_at'] }
    ]
})

export default ChatLog