import { Link } from 'react-router-dom'
import './PhotoDiagnosisCta.css'

function PhotoDiagnosisCta() {
    return (
        <section className='photoDiagnosis' aria-labelledby='photoDiagnosisTitle'>
            <div className='photoDiagnosisBody'>
                <h2 className='photoDiagnosisTitle' id='photoDiagnosisTitle'>Проверить растение по фото</h2>
                <p className='photoDiagnosisLead'>
                    Пожелтение листьев редко объясняется одной причиной: перелив, нехватка света,
                    жёсткая вода и вредители дают похожую картину. Пришлите фото ИИ-помощнику
                    «Лейки» — он посмотрит листья, стебли и грунт и подскажет, с чего начать.
                </p>
                <ol className='photoDiagnosisSteps'>
                    <li>Сфотографируйте растение целиком при дневном свете.</li>
                    <li>Отдельно снимите пожелтевшие листья и грунт у корней.</li>
                    <li>Прикрепите фото в чате и задайте уточняющий вопрос.</li>
                </ol>
            </div>
            <div className='photoDiagnosisActions'>
                <Link className='photoDiagnosisPrimary' to='/register'>
                    Проверить по фото
                </Link>
                <p className='photoDiagnosisNote'>
                    Диагностика по фото доступна в бесплатном аккаунте: чат с ИИ-помощником
                    откроется сразу после регистрации.
                </p>
                <Link className='photoDiagnosisSecondary' to='/plants'>
                    Сначала уточнить вид растения
                </Link>
            </div>
        </section>
    )
}

export default PhotoDiagnosisCta
