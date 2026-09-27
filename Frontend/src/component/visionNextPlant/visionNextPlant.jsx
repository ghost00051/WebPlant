import { useEffect } from 'react'
import EmptyIcon from '../../assets/EmptyIcon.svg'
import './visionNextPlant.css'

function pluralizePlants(n) {
    const abs = Math.abs(n) % 100
    const last = abs % 10
    if (abs > 10 && abs < 20) return 'растений'
    if (last === 1) return 'растение'
    if (last >= 2 && last <= 4) return 'растения'
    return 'растений'
}

function VisionNextPlant({ active, day, onClose }) {
    useEffect(() => {
        document.body.classList.toggle('vision-open', active)
        return () => document.body.classList.remove('vision-open')
    }, [active])

    const plantsCount = day?.plants?.length ?? 0
    const hasEvents = plantsCount > 0

    const plantsLabel =
        plantsCount === 1
            ? '1 растение ждёт полива'
            : `${plantsCount} ${pluralizePlants(plantsCount)} ждут полива`

    return (
        <div
            className={`vision-overlay ${active ? 'is-active' : ''}`}
            onClick={onClose}
        >
            <div
                className={`visiibleVareingPlant ${active ? 'active' : ''}`}
                onClick={e => e.stopPropagation()}
            >
                <div className='childOfBlockvisiibleVareingPlant'>
                    <div><span /></div>

                    <div>
                        <div>
                            {day ? (
                                <>
                                    <p className='selectDayCheck'>{day.full}</p>

                                    <div className='selectDayHeader'>
                                        <p className='selectDayRelative'>{day.relative}</p>
                                        <span />

                                        {hasEvents ? (
                                            <p className='selectDayPlants'>{plantsLabel}</p>
                                        ) : (
                                            <p className='selectDayPlants selectDayPlants--empty'>
                                                Событий нет
                                            </p>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <p className='selectDayCheck'>Выберите день</p>
                            )}
                        </div>

                        {day && !hasEvents && (
                            <div className='selectDayEmpty'>
                                <img src={EmptyIcon} alt="" />
                                <p>В этот день ничего не произошло</p>
                                <p>Здесь появятся поливы и добавленные растения. Можно добавить запись вручную или посмотреть другую дату.</p>
                            </div>
                        )}

                        {day && hasEvents && (
                            <ul className='plantsPreview'>
                                {day.plants.map(p => (
                                    <li key={p.id} className='plantsPreview__item'>
                                        <span className='plantsPreview__dot' />
                                        <span className='plantsPreview__name'>{p.name}</span>
                                        {p.location && (
                                            <span className='plantsPreview__location'>{p.location}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div>
                            <p></p>
                        </div>
                    </div>

                    <div />
                </div>
            </div>
        </div>
    )
}

export default VisionNextPlant