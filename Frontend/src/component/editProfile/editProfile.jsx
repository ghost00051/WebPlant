import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import BackBtn from '../../assets/BackBtn.svg'
import './editProfile.css'
import './dark-theme.css'
import { API_URL } from '../../utils/api.js'

function EditProfile() {
    const navigate = useNavigate()
    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [rendName, setRendName] = useState("")
    const [rendNamePtofile, setNamePtofile] = useState("")
    const [rendEmail, setRendEmail] = useState("")
    const [bio, setBio] = useState("")
    const [phone, setPhone] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [successMessage, setSuccessMessage] = useState('')

    const parseJsonSafely = async (response) => {
        const text = await response.text()
        if (!text) return {}

        try {
            return JSON.parse(text)
        } catch (error) {
            console.error('Ошибка разбора JSON ответа:', error)
            return {}
        }
    }

    const normalizePhone = (value) => {
        const digits = value.replace(/\D/g, '')
        if (!digits) return ''

        let d = digits
        if (d.startsWith('8')) d = '7' + d.slice(1)
        if (!d.startsWith('7')) d = '7' + d
        d = d.slice(0, 11)

        return '+' + d
    }

    const handleEditProfile = async (event) => {
        event.preventDefault()
        setError(null)
        setSuccessMessage('')
        setSubmitting(true)

        try {
            const response = await fetch(
                `${API_URL}/users/me`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        name: rendName,
                        username: rendNamePtofile,
                        bio,
                        phone: normalizePhone(phone)
                    })
                }
            )

            const responseData = await parseJsonSafely(response)

            if (response.ok) {
                setSuccessMessage('Профиль успешно сохранён')
                setTimeout(() => {
                    navigate('/home', {
                        replace: true,
                        state: { activeTab: 'profile' }
                    })
                }, 1200)
                return
            }

            console.error(responseData)
            setError(responseData?.message || 'Ошибка сохранения')
        } catch (err) {
            console.error('Edit profile error:', err)
            setError('Ошибка при сохранении. Попробуйте ещё раз.')
        } finally {
            setSubmitting(false)
        }
    }

    const formatPhone = (value) => {
        let digits = value.replace(/\D/g, '')
        if (digits.startsWith('8')) {
            digits = '7' + digits.slice(1)
        }

        if (digits && !digits.startsWith('7')) {
            digits = '7' + digits
        }

        digits = digits.slice(0, 11)

        if (!digits) return ''

        const d = digits.slice(1)
        let result = '+7'

        if (d.length > 0) result += ' (' + d.slice(0, 3)
        if (d.length >= 3) result += ') ' + d.slice(3, 6)
        if (d.length >= 6) result += ' - ' + d.slice(6, 8)
        if (d.length >= 8) result += ' - ' + d.slice(8, 10)

        return result
    }

    useEffect(() => {
        let isMounted = true

        const loadProfile = async () => {
            setLoading(true)
            setError(null)

            try {
                const response = await fetch(
                    `${API_URL}/users/me`,
                    { method: 'GET', credentials: 'include' }
                )
                if (!response.ok) throw new Error(`HTTP ${response.status}`)

                const data = await parseJsonSafely(response)
                if (!isMounted) return

                setProfile(data)
                setRendName(data.name ?? '')
                setNamePtofile(data.username ?? '')
                setRendEmail(data.email ?? '')
                setBio(data.bio ?? '')
                setPhone(data.phone ?? '')
            } catch (loadError) {
                console.error('Ошибка получения профиля:', loadError)
                if (isMounted) setError('Не удалось загрузить профиль')
            } finally {
                if (isMounted) setLoading(false)
            }
        }

        loadProfile()

        return () => {
            isMounted = false
        }
    }, [])

    return (
        <div className='editProfilePage'>
            <div className='editProfileHeader'>
                <img
                    src={BackBtn}
                    alt="Назад"
                    onClick={() => navigate(-1)}
                    style={{ cursor: 'pointer' }}
                />
                <p>Редактировать профиль</p>
            </div>

            {loading && <p>Загрузка...</p>}
            {error && <p className='editProfileError'>{error}</p>}
            {successMessage && (
                <p className='editProfileSuccess' role='status' aria-live='polite'>
                    {successMessage}
                </p>
            )}

            {profile && (
                <div className='headerOfImgNames'>
                    <div className='imgOfName'>
                        <p>{profile.name?.[0] ?? '?'}</p>
                    </div>
                </div>
            )}
            <div>
                <form onSubmit={handleEditProfile} >
                    <div className='editProfile'>
                        <label>
                            <p>Имя</p>
                            <input
                                type="text"
                                value={rendName}
                                onChange={(e) => setRendName(e.target.value)}
                            />
                        </label>
                        <label>
                            <p>Имя пользователя</p>
                            <input
                                type="text"
                                value={rendNamePtofile}
                                onChange={(e) => setNamePtofile(e.target.value)}
                            />
                        </label>
                        <label>
                            <p>О себе</p>
                            <input
                                type="text"
                                value={bio}
                                onChange={(e) => setBio(e.target.value)}
                            />
                        </label>
                        <label>
                            <p>Email</p>
                            <input
                                type="email"
                                value={rendEmail}
                                onChange={(e) => setRendEmail(e.target.value)}
                            />
                        </label>
                        <label>
                            <p>Телефон (необязательно)</p>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(formatPhone(e.target.value))}
                                placeholder='+7 (___) ___ - __ -__'
                            />
                        </label>
                    </div>
                    <button className='saveOfEditProfile' disabled={submitting}>
                        {submitting ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </form>
            </div>
        </div>
    )
}

export default EditProfile