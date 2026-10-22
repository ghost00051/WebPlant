import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const ProductEvent = sequelize.define('product_event', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'SET NULL'
    },
    visitor_id: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    event: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    properties: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    path: {
        type: DataTypes.STRING(300),
        allowNull: true
    },
    referrer_host: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'product_events',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        { name: 'idx_product_events_created_at', fields: ['created_at'] },
        { name: 'idx_product_events_user_created', fields: ['user_id', 'created_at'] },
        { name: 'idx_product_events_event_created', fields: ['event', 'created_at'] },
        { name: 'idx_product_events_visitor_created', fields: ['visitor_id', 'created_at'] }
    ]
})

export default ProductEvent
