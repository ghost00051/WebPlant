#Requires -Version 5.1
<#
.SYNOPSIS
    Удаление стека WebPlant из Kubernetes.

.DESCRIPTION
    По умолчанию удаляются только рабочие нагрузки (deployments, services, jobs),
    секреты и тома остаются. С -RemoveData удаляется весь namespace вместе с PVC —
    это необратимо уничтожит базу и загруженные фото в кластере.
    Compose-стек не затрагивается.

.EXAMPLE
    powershell -File Backend/k8s/scripts/teardown.ps1
    powershell -File Backend/k8s/scripts/teardown.ps1 -RemoveData -RemoveGateway
#>
[CmdletBinding()]
param(
    [string]$Namespace = 'webplant',
    [switch]$RemoveData,
    [switch]$RemoveGateway,
    [switch]$RemoveImages
)

# Мягкий режим ошибок: в Windows PowerShell 5.1 запись docker/kubectl в stderr
# при ErrorActionPreference = 'Stop' прерывает скрипт (например, если namespace
# уже удалён), а для уборки это не нужно.
$ErrorActionPreference = 'Continue'
$GatewayName = 'ctp_k8s_gateway'
$ImageServerName = 'ctp_k8s_img_server'

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

if ($RemoveData) {
    Write-Step "Удаляю namespace $Namespace вместе с томами (данные будут потеряны)"
    kubectl delete namespace $Namespace --ignore-not-found
} else {
    Write-Step 'Удаляю рабочие нагрузки (тома и секреты остаются)'
    kubectl delete deployment,statefulset,service,daemonset -n $Namespace --all --ignore-not-found
    kubectl delete job -n $Namespace --all --ignore-not-found
    Write-Host 'PVC, ConfigMap и Secret сохранены. Полное удаление: -RemoveData'
}

if ($RemoveGateway) {
    Write-Step 'Удаляю gateway и сервер образов'
    docker rm -f $GatewayName 2>$null | Out-Null
    docker rm -f $ImageServerName 2>$null | Out-Null
}

if ($RemoveImages) {
    Write-Step 'Удаляю локальные образы webplant-backend'
    $images = docker images --format '{{.Repository}}:{{.Tag}}' --filter 'reference=webplant-backend*'
    foreach ($image in $images) {
        if ($image) { docker rmi $image 2>$null | Out-Null }
    }
}

Write-Step 'Готово'
kubectl get all -n $Namespace --ignore-not-found
