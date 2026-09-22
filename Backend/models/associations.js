import User from './userModels.js'
import Plant from './Plant.js'
import PlantPhoto from './PlantPhoto.js'

User.hasMany(Plant, {
    foreignKey: 'user_id',
    as: 'plants',
    onDelete: 'CASCADE'
})
Plant.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
})

// Plant -> PlantPhoto
Plant.hasMany(PlantPhoto, {
    foreignKey: 'plant_id',
    as: 'photos',
    onDelete: 'CASCADE'
})
PlantPhoto.belongsTo(Plant, {
    foreignKey: 'plant_id',
    as: 'plant'
})

export { User, Plant, PlantPhoto }