#!/bin/bash

# Docker Compose convenience script for WayMaze

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_color() {
    printf "${2}${1}${NC}\n"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_color "Docker is not running. Please start Docker first." "$RED"
        exit 1
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start         Start all services (default base path)"
    echo "  start-prod    Start all services with production base path (ENV=prod)"
    echo "  start-dev     Start all services in development mode with hot-reload"
    echo "  stop          Stop all running services"
    echo "  restart       Restart all services"
    echo "  build         Build all Docker images"
    echo "  build-prod    Build all Docker images with production base path (ENV=prod)"
    echo "  rebuild       Rebuild all Docker images (no cache)"
    echo "  rebuild-prod  Rebuild all Docker images with production base path (ENV=prod)"
    echo "  logs          Show logs for all services"
    echo "  logs-f        Follow logs for all services"
    echo "  status        Show status of all services"
    echo "  clean         Stop and remove all containers, networks, and volumes"
    echo "  help          Show this help message"
    echo ""
}

# Check Docker is running
check_docker

# Parse command
case "$1" in
    start)
        print_color "Starting WayMaze..." "$GREEN"
        docker-compose up -d
        print_color "WayMaze is running!" "$GREEN"
        print_color "Client: http://localhost:8093" "$YELLOW"
        print_color "Server: http://localhost:8092" "$YELLOW"
        ;;

    start-prod)
        print_color "Starting WayMaze with production base path (ENV=prod)..." "$GREEN"
        docker-compose build --build-arg ENV=prod client
        docker-compose build server
        docker-compose up -d
        print_color "WayMaze is running with production base path!" "$GREEN"
        print_color "Client: http://localhost:8093" "$YELLOW"
        print_color "Server: http://localhost:8092" "$YELLOW"
        ;;

    start-dev)
        print_color "Starting WayMaze in development mode..." "$GREEN"
        docker-compose -f docker-compose.dev.yml up
        ;;

    stop)
        print_color "Stopping WayMaze..." "$YELLOW"
        docker-compose down
        print_color "WayMaze stopped." "$GREEN"
        ;;

    restart)
        print_color "Restarting WayMaze..." "$YELLOW"
        docker-compose restart
        print_color "WayMaze restarted." "$GREEN"
        ;;

    build)
        print_color "Building WayMaze Docker images..." "$GREEN"
        docker-compose build
        print_color "Build complete!" "$GREEN"
        ;;

    build-prod)
        print_color "Building WayMaze Docker images with production base path (ENV=prod)..." "$GREEN"
        docker-compose build --build-arg ENV=prod client
        docker-compose build server
        print_color "Build complete!" "$GREEN"
        ;;

    rebuild)
        print_color "Rebuilding WayMaze Docker images (no cache)..." "$GREEN"
        docker-compose build --no-cache
        print_color "Rebuild complete!" "$GREEN"
        ;;

    rebuild-prod)
        print_color "Rebuilding WayMaze Docker images with production base path (ENV=prod, no cache)..." "$GREEN"
        docker-compose build --build-arg ENV=prod --no-cache client
        docker-compose build --no-cache server
        print_color "Rebuild complete!" "$GREEN"
        ;;

    logs)
        docker-compose logs "$@"
        ;;

    logs-f)
        docker-compose logs -f
        ;;

    status)
        print_color "WayMaze services status:" "$GREEN"
        docker-compose ps
        ;;

    clean)
        print_color "Cleaning up WayMaze..." "$YELLOW"
        docker-compose down -v --rmi local
        print_color "Cleanup complete!" "$GREEN"
        ;;

    help|--help|-h)
        show_usage
        ;;

    *)
        print_color "Invalid command: $1" "$RED"
        echo ""
        show_usage
        exit 1
        ;;
esac
