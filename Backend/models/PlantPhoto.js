import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const PlantPhoto = sequelize.define("plant_photo", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    plant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'plants',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    url: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Порядок отображения фото (0 — главное)'
    },
    is_main: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Главное фото растения'
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}, {
    tableName: 'plant_photos',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { name: 'idx_plant_photos_plant', fields: ['plant_id'] },
        { name: 'idx_plant_photos_sort', fields: ['plant_id', 'sort_order'] }
    ]
})

export default PlantPhoto